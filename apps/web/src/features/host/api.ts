import { request } from "../../lib/http";
import type { HostJob, HostStatus, TransferRequest } from "./types";

export const hostApi = {
  status: () => request<HostStatus>("/host/status"),
  probe: (data: { ip: string; port: number }) =>
    request<HostJob>("/host/probe", "POST", data),
  transfer: (data: TransferRequest) =>
    request<HostJob>("/host/transfer", "POST", data),
  domain: (data: {
    domain: string;
    current_password: string;
    dns_confirmed: true;
  }) => request<HostJob>("/host/domain", "POST", data),
  remove: (data: {
    confirmation: string;
    current_password: string;
    instance_id: string;
  }) => request<HostJob>("/host/remove", "POST", data),
  cancel: (data: { current_password: string }) =>
    request<HostJob>("/host/cancel-transfer", "POST", data),
};
