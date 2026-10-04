// 需求单八态状态机的客户端镜像（api 仓 fd_wire_api/demands/statemachine.py
// 的 ALLOWED_TRANSITIONS 白名单）。派发台下拉用它禁用非法迁移项——
// 服务端仍是唯一裁决面（409 如实回显）。
import type { DemandStatus } from "./api";

export const ALL_DEMAND_STATUSES: DemandStatus[] = [
  "submitted",
  "evaluating",
  "quoted",
  "awaiting_confirm",
  "building",
  "delivery_acceptance",
  "delivered",
  "rejected",
];

export const ALLOWED_TRANSITIONS: Record<DemandStatus, DemandStatus[]> = {
  submitted: ["evaluating"],
  evaluating: ["quoted", "rejected"],
  quoted: ["awaiting_confirm", "rejected"],
  awaiting_confirm: ["building", "rejected"],
  building: ["delivery_acceptance", "building"],
  delivery_acceptance: ["delivered"],
  delivered: [],
  rejected: [],
};

/** 当前状态下允许迁往的目标（终态为空数组 → 下拉整体禁用）。 */
export function allowedTargets(current: DemandStatus): DemandStatus[] {
  return ALLOWED_TRANSITIONS[current] ?? [];
}

/** 迁移到 rejected 必带理由（状态机硬前置）。 */
export function needsReason(target: DemandStatus): boolean {
  return target === "rejected";
}

/** evaluating → quoted 必须后台人工确认（confirmed_by_operator + operator）。 */
export function needsOperatorConfirmation(target: DemandStatus): boolean {
  return target === "quoted";
}
