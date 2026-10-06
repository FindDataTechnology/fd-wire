package runner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/FindDataTechnology/fd-wire/connector/internal/adapters"
	"github.com/FindDataTechnology/fd-wire/connector/internal/client"
)

type fakeAdapter struct {
	columns []adapters.Column
	pks     []string
	batches [][]adapters.Row
	snapErr error
	colsErr error
	onSnap  func()
}

func (f *fakeAdapter) Columns(context.Context) ([]adapters.Column, error) {
	return f.columns, f.colsErr
}

func (f *fakeAdapter) PrimaryKeys(context.Context) ([]string, error) { return f.pks, nil }

func (f *fakeAdapter) Snapshot(ctx context.Context, fn adapters.SnapshotFunc) error {
	if f.onSnap != nil {
		f.onSnap()
	}
	for _, batch := range f.batches {
		if err := fn(batch); err != nil {
			return err
		}
	}
	return f.snapErr
}

type mockAPI struct {
	mu           sync.Mutex
	beginCalls   int
	commitCalls  int
	abortCalls   int
	chunkRows    []int
	chunkIndexes []int
	beginBody    client.SyncBeginRequest
	beginStatus  int
	beginDetail  string
	commitStatus int
	commitDetail string
	syncID       string
}

func (m *mockAPI) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		m.mu.Lock()
		defer m.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == client.PathSyncs:
			m.beginCalls++
			if err := json.NewDecoder(r.Body).Decode(&m.beginBody); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if m.beginStatus != 0 {
				w.WriteHeader(m.beginStatus)
				fmt.Fprintf(w, `{"detail":%q}`, m.beginDetail)
				return
			}
			fmt.Fprintf(w, `{"sync_id":%q}`, m.syncID)
		case strings.HasSuffix(r.URL.Path, "/chunks"):
			var body client.SyncChunkRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			m.chunkRows = append(m.chunkRows, len(body.Rows))
			m.chunkIndexes = append(m.chunkIndexes, body.Index)
			fmt.Fprintf(w, `{"accepted":%d}`, len(body.Rows))
		case strings.HasSuffix(r.URL.Path, "/commit"):
			m.commitCalls++
			if m.commitStatus != 0 {
				w.WriteHeader(m.commitStatus)
				fmt.Fprintf(w, `{"detail":%q}`, m.commitDetail)
				return
			}
			fmt.Fprint(w, `{"status":"ok","rows":2500}`)
		case strings.HasSuffix(r.URL.Path, "/abort"):
			m.abortCalls++
			fmt.Fprint(w, `{"aborted":true}`)
		default:
			w.WriteHeader(http.StatusNotFound)
			fmt.Fprint(w, `{"detail":"no route"}`)
		}
	}
}

func (m *mockAPI) newClient(t *testing.T) *client.Client {
	t.Helper()
	srv := httptest.NewServer(m.handler())
	t.Cleanup(srv.Close)
	c, err := client.New(srv.URL, "fwc_key", client.WithSleep(func(context.Context, time.Duration) {}))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func testDataset() client.DatasetConfig {
	return client.DatasetConfig{Key: "sales", Source: "erp_db", SourceRef: "public.sales"}
}

func TestSyncPushesChunksAndCommits(t *testing.T) {
	rows := make([]adapters.Row, 2500)
	for i := range rows {
		rows[i] = adapters.Row{"id": int64(i)}
	}
	api := &mockAPI{syncID: "sync-1"}
	r := &Runner{
		Client: api.newClient(t),
		Factory: func(client.DatasetConfig) (adapters.Adapter, error) {
			return &fakeAdapter{
				columns: []adapters.Column{{Name: "id", Type: adapters.TypeInteger}},
				pks:     []string{"id"},
				batches: [][]adapters.Row{rows},
			}, nil
		},
	}
	result, err := r.Sync(context.Background(), testDataset())
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if result.Rows != 2500 || result.Chunks != 2 || result.CommitRows != 2500 {
		t.Fatalf("结果 = %#v", result)
	}
	api.mu.Lock()
	defer api.mu.Unlock()
	if api.beginCalls != 1 || api.commitCalls != 1 || api.abortCalls != 0 {
		t.Fatalf("调用计数 begin=%d commit=%d abort=%d", api.beginCalls, api.commitCalls, api.abortCalls)
	}
	if fmt.Sprint(api.chunkRows) != "[2000 500]" {
		t.Fatalf("块大小 = %v, want [2000 500]（契约 §3.3 上限 2000）", api.chunkRows)
	}
	if fmt.Sprint(api.chunkIndexes) != "[0 2000]" {
		t.Fatalf("块序号 = %v, want [0 2000]", api.chunkIndexes)
	}
	if api.beginBody.DatasetKey != "sales" || api.beginBody.PKColumns[0] != "id" {
		t.Fatalf("begin 请求体 = %#v", api.beginBody)
	}
	if len(api.beginBody.Columns) != 1 || api.beginBody.Columns[0].Type != "INTEGER" {
		t.Fatalf("begin 列声明 = %#v", api.beginBody.Columns)
	}
}

func TestSyncAbortsOnSnapshotError(t *testing.T) {
	api := &mockAPI{syncID: "sync-1"}
	r := &Runner{
		Client: api.newClient(t),
		Factory: func(client.DatasetConfig) (adapters.Adapter, error) {
			return &fakeAdapter{
				columns: []adapters.Column{{Name: "id", Type: adapters.TypeInteger}},
				batches: [][]adapters.Row{{{"id": int64(1)}}},
				snapErr: errors.New("源库连接中断"),
			}, nil
		},
	}
	_, err := r.Sync(context.Background(), testDataset())
	if err == nil || !strings.Contains(err.Error(), "源库连接中断") {
		t.Fatalf("应报快照错误: %v", err)
	}
	api.mu.Lock()
	defer api.mu.Unlock()
	if api.commitCalls != 0 {
		t.Error("失败不应 commit")
	}
	if api.abortCalls != 1 {
		t.Fatalf("失败必须 abort，abort 调用 = %d", api.abortCalls)
	}
}

func TestSyncAbortsOnCommitDrift(t *testing.T) {
	api := &mockAPI{syncID: "sync-1", commitStatus: http.StatusConflict, commitDetail: "drift: 列 price 缺失"}
	r := &Runner{
		Client: api.newClient(t),
		Factory: func(client.DatasetConfig) (adapters.Adapter, error) {
			return &fakeAdapter{
				columns: []adapters.Column{{Name: "id", Type: adapters.TypeInteger}},
				batches: [][]adapters.Row{{{"id": int64(1)}}},
			}, nil
		},
	}
	_, err := r.Sync(context.Background(), testDataset())
	if !client.IsDrift(err) {
		t.Fatalf("commit 409 应判为漂移: %v", err)
	}
	api.mu.Lock()
	defer api.mu.Unlock()
	if api.abortCalls != 1 {
		t.Fatalf("漂移后应 abort 清理，abort 调用 = %d", api.abortCalls)
	}
}

func TestSyncDoesNotAbortWhenBeginFails(t *testing.T) {
	api := &mockAPI{syncID: "sync-1", beginStatus: http.StatusTooManyRequests, beginDetail: "quota: 存储超限"}
	r := &Runner{
		Client: api.newClient(t),
		Factory: func(client.DatasetConfig) (adapters.Adapter, error) {
			return &fakeAdapter{columns: []adapters.Column{{Name: "id", Type: adapters.TypeInteger}}}, nil
		},
	}
	_, err := r.Sync(context.Background(), testDataset())
	if !client.IsQuota(err) {
		t.Fatalf("begin 429 应判为配额超限: %v", err)
	}
	api.mu.Lock()
	defer api.mu.Unlock()
	if api.abortCalls != 0 || api.chunkRows != nil {
		t.Fatalf("begin 失败无需 abort 也无块推送: abort=%d chunks=%v", api.abortCalls, api.chunkRows)
	}
}

func TestSyncAbortsEvenWhenParentContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	api := &mockAPI{syncID: "sync-1"}
	r := &Runner{
		Client: api.newClient(t),
		Factory: func(client.DatasetConfig) (adapters.Adapter, error) {
			return &fakeAdapter{
				columns: []adapters.Column{{Name: "id", Type: adapters.TypeInteger}},
				onSnap:  cancel, // 快照中途进程收到停止信号
			}, nil
		},
	}
	_, err := r.Sync(ctx, testDataset())
	if err == nil {
		t.Fatal("ctx 取消应返回错误")
	}
	api.mu.Lock()
	defer api.mu.Unlock()
	if api.abortCalls != 1 {
		t.Fatalf("ctx 取消也要尽力 abort，abort 调用 = %d", api.abortCalls)
	}
}

func TestSyncFailsWithoutTouchingAPI(t *testing.T) {
	api := &mockAPI{syncID: "sync-1"}
	r := &Runner{
		Client: api.newClient(t),
		Factory: func(client.DatasetConfig) (adapters.Adapter, error) {
			return nil, errors.New("本地未配置源 erp_db")
		},
	}
	_, err := r.Sync(context.Background(), testDataset())
	if err == nil || !strings.Contains(err.Error(), "本地未配置源") {
		t.Fatalf("工厂错误应原样返回: %v", err)
	}
	api.mu.Lock()
	defer api.mu.Unlock()
	if api.beginCalls != 0 || api.abortCalls != 0 {
		t.Fatalf("源不可用不应发起任何 api 调用: begin=%d abort=%d", api.beginCalls, api.abortCalls)
	}
}

func TestSyncFailsOnColumnsError(t *testing.T) {
	api := &mockAPI{syncID: "sync-1"}
	r := &Runner{
		Client: api.newClient(t),
		Factory: func(client.DatasetConfig) (adapters.Adapter, error) {
			return &fakeAdapter{colsErr: errors.New("连接被拒绝")}, nil
		},
	}
	_, err := r.Sync(context.Background(), testDataset())
	if err == nil || !strings.Contains(err.Error(), "读取源结构失败") {
		t.Fatalf("读取源结构失败应报错: %v", err)
	}
	api.mu.Lock()
	defer api.mu.Unlock()
	if api.beginCalls != 0 {
		t.Fatalf("读列失败不应 begin: %d", api.beginCalls)
	}
}

func TestSyncRequiresClientAndFactory(t *testing.T) {
	if _, err := (&Runner{}).Sync(context.Background(), testDataset()); err == nil {
		t.Error("缺客户端应报错")
	}
	api := &mockAPI{syncID: "s"}
	if _, err := (&Runner{Client: api.newClient(t)}).Sync(context.Background(), testDataset()); err == nil {
		t.Error("缺适配器工厂应报错")
	}
}
