// Package postgres 是 PostgreSQL 源适配器（pgx/v5）：列/主键取自 information_schema
// 与 pg_catalog，全量拉取按行流式读取（不在客户端整表进内存）。
package postgres

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/FindDataTechnology/fd-wire/connector/internal/adapters"
)

// Adapter 读取 dsn 指向库中的 Table（可写 "schema.table"，schema 缺省用 current_schema()）。
type Adapter struct {
	DSN       string
	Table     string
	BatchSize int
}

// New 建 PostgreSQL 适配器；BatchSize<=0 时用 2000。
func New(dsn, table string, batchSize int) *Adapter {
	if batchSize <= 0 {
		batchSize = 2000
	}
	return &Adapter{DSN: dsn, Table: strings.TrimSpace(table), BatchSize: batchSize}
}

func (a *Adapter) schemaTable() (schema, table string, err error) {
	if a.Table == "" {
		return "", "", fmt.Errorf("postgres 适配器缺少 source_ref（应为表名，可带 schema 前缀）")
	}
	parts := strings.Split(a.Table, ".")
	switch len(parts) {
	case 1:
		return "", parts[0], nil
	case 2:
		return parts[0], parts[1], nil
	default:
		return "", "", fmt.Errorf("source_ref %q 不是合法的表名", a.Table)
	}
}

func (a *Adapter) connect(ctx context.Context) (*pgx.Conn, error) {
	conn, err := pgx.Connect(ctx, a.DSN)
	if err != nil {
		return nil, fmt.Errorf("连接 PostgreSQL 失败: %w", err)
	}
	return conn, nil
}

// Columns 从 information_schema 读列名与类型并映射到引擎三型。
func (a *Adapter) Columns(ctx context.Context) ([]adapters.Column, error) {
	schema, table, err := a.schemaTable()
	if err != nil {
		return nil, err
	}
	conn, err := a.connect(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.WithoutCancel(ctx))

	const q = `SELECT column_name, COALESCE(NULLIF(udt_name, ''), data_type)
	           FROM information_schema.columns
	           WHERE table_name = $1 AND table_schema = COALESCE(NULLIF($2, ''), current_schema())
	           ORDER BY ordinal_position`
	rows, err := conn.Query(ctx, q, table, schema)
	if err != nil {
		return nil, fmt.Errorf("查询 %s 列定义失败: %w", a.Table, err)
	}
	defer rows.Close()
	var cols []adapters.Column
	for rows.Next() {
		var name, udt string
		if err := rows.Scan(&name, &udt); err != nil {
			return nil, fmt.Errorf("读取列定义失败: %w", err)
		}
		cols = append(cols, adapters.Column{Name: name, Type: adapters.MapSQLType(udt)})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("读取列定义失败: %w", err)
	}
	if len(cols) == 0 {
		return nil, fmt.Errorf("表 %s 不存在或无可见列（受限账号请确认库级权限）", a.Table)
	}
	return cols, nil
}

// PrimaryKeys 读主键列（无主键返回空表，由引擎行走哈希锚）。
func (a *Adapter) PrimaryKeys(ctx context.Context) ([]string, error) {
	schema, table, err := a.schemaTable()
	if err != nil {
		return nil, err
	}
	conn, err := a.connect(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.WithoutCancel(ctx))

	const q = `SELECT a.attname
	           FROM pg_index i
	           JOIN pg_class c ON c.oid = i.indrelid
	           JOIN pg_namespace n ON n.oid = c.relnamespace
	           JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
	           WHERE i.indisprimary
	             AND c.relname = $1
	             AND n.nspname = COALESCE(NULLIF($2, ''), current_schema())
	           ORDER BY array_position(i.indkey, a.attnum)`
	rows, err := conn.Query(ctx, q, table, schema)
	if err != nil {
		return nil, fmt.Errorf("查询 %s 主键失败: %w", a.Table, err)
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("读取主键失败: %w", err)
		}
		keys = append(keys, name)
	}
	return keys, rows.Err()
}

// Snapshot 全量拉取：SELECT * 逐行流式扫描，按批次回调。
func (a *Adapter) Snapshot(ctx context.Context, fn adapters.SnapshotFunc) error {
	schema, table, err := a.schemaTable()
	if err != nil {
		return err
	}
	conn, err := a.connect(ctx)
	if err != nil {
		return err
	}
	defer conn.Close(context.WithoutCancel(ctx))

	rows, err := conn.Query(ctx, "SELECT * FROM "+quoteQualified(schema, table))
	if err != nil {
		return fmt.Errorf("查询 %s 失败: %w", a.Table, err)
	}
	defer rows.Close()

	fields := rows.FieldDescriptions()
	names := make([]string, len(fields))
	engineTypes := make([]string, len(fields))
	for i, f := range fields {
		names[i] = string(f.Name)
		// 用字段 OID 的实际类型名走同一张映射表，保证与 Columns() 声明的三型一致。
		pgName := ""
		if typ, ok := conn.TypeMap().TypeForOID(f.DataTypeOID); ok {
			pgName = typ.Name
		}
		engineTypes[i] = adapters.MapSQLType(pgName)
	}
	batch := adapters.NewBatcher(a.BatchSize, fn)
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return fmt.Errorf("读取 %s 数据行失败: %w", a.Table, err)
		}
		row := make(adapters.Row, len(names))
		for i, name := range names {
			if i < len(values) {
				row[name] = NormalizeValue(values[i], engineTypes[i])
			}
		}
		if err := batch.Add(row); err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("读取 %s 数据失败: %w", a.Table, err)
	}
	return batch.Flush()
}

// NormalizeValue 把 pgx 返回的原生值收敛为引擎三型可接受的 JSON 值
// （time 统一 UTC ISO8601，bytea → string，numeric 按目标三型转数字）。
func NormalizeValue(value any, engineType string) any {
	switch v := value.(type) {
	case nil:
		return nil
	case time.Time:
		return v.UTC().Format(time.RFC3339Nano)
	case []byte:
		return string(v)
	case [16]byte: // uuid
		return fmt.Sprintf("%x-%x-%x-%x-%x", v[0:4], v[4:6], v[6:8], v[8:10], v[10:16])
	case pgtype.Numeric:
		switch engineType {
		case adapters.TypeInteger:
			if f, err := numericFloat(v); err == nil {
				return int64(f)
			}
		case adapters.TypeReal:
			if f, err := numericFloat(v); err == nil {
				return f
			}
		}
		return driverText(v)
	default:
		// driver.Valuer 兜底（pgtype.Interval 等驱动特有结构），再退回 %v 文本。
		return driverText(value)
	}
}

func numericFloat(n pgtype.Numeric) (float64, error) {
	fv, err := n.Float64Value()
	if err != nil {
		return 0, err
	}
	if !fv.Valid {
		return 0, errors.New("numeric 无有效值")
	}
	return fv.Float64, nil
}

func driverText(value any) any {
	if valuer, ok := value.(driver.Valuer); ok {
		if driverValue, err := valuer.Value(); err == nil && driverValue != nil {
			return adapters.Coerce(driverValue, adapters.TypeText)
		}
	}
	return adapters.Coerce(value, adapters.TypeText)
}

// quoteQualified 组合带引号的安全表名（标识符走 pgx 转义，杜绝注入）。
func quoteQualified(parts ...string) string {
	quoted := make([]string, 0, len(parts))
	for _, p := range parts {
		if strings.TrimSpace(p) == "" {
			continue
		}
		quoted = append(quoted, pgx.Identifier{p}.Sanitize())
	}
	return strings.Join(quoted, ".")
}
