import * as React from 'react';
import { Card, CardBody, Chip } from '@heroui/react';
import type { SSTVDecoderEvent } from '@tx5dr/contracts';
import { useSSTV } from '../../hooks/useSSTV';

function formatTimestamp(ts: number | null): string {
  if (!ts || !Number.isFinite(ts)) {
    return '--';
  }
  return new Date(ts).toLocaleTimeString();
}

function formatEventLine(event: SSTVDecoderEvent): string {
  if (event.type === 'vis_detected') {
    return `${formatTimestamp(event.timestamp)} · ${event.mode} · VIS ${event.visCode} · ${(event.confidence * 100).toFixed(0)}%`;
  }
  if (event.type === 'sync_detected') {
    return `${formatTimestamp(event.timestamp)} · Sync detected`;
  }
  if (event.type === 'rx_image_decoded') {
    return `${formatTimestamp(event.timestamp)} · RX图像解码完成 · ${event.mode}`;
  }
  if (event.type === 'tx_prepared') {
    return `${formatTimestamp(event.timestamp)} · TX已编码 · ${event.mode} · ${(event.durationMs / 1000).toFixed(1)}s`;
  }
  if (event.type === 'tx_started') {
    return `${formatTimestamp(event.timestamp)} · TX发送中 · ${event.mode}`;
  }
  if (event.type === 'tx_completed') {
    return event.success
      ? `${formatTimestamp(event.timestamp)} · TX发送完成 · ${event.mode}`
      : `${formatTimestamp(event.timestamp)} · TX发送失败 · ${event.error ?? 'unknown'}`;
  }
  return `${formatTimestamp(event.timestamp)} · ${event.error}`;
}

export const SSTVRxPanel: React.FC = () => {
  const { status, events, latestRxImage } = useSSTV();
  const latestEvents = React.useMemo(() => [...events].reverse().slice(0, 8), [events]);

  return (
    <Card shadow="sm" className="h-full min-h-0 overflow-hidden">
      <CardBody className="h-full min-h-0 p-3 md:p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">SSTV RX</div>
          <Chip
            size="sm"
            color={status.state === 'running' ? 'success' : status.state === 'error' ? 'danger' : 'default'}
            variant="flat"
          >
            {status.state}
          </Chip>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md bg-content2 px-2 py-1.5">模式: {status.lastDetectedMode ?? '--'}</div>
          <div className="rounded-md bg-content2 px-2 py-1.5">VIS: {status.lastVisCode ?? '--'}</div>
          <div className="rounded-md bg-content2 px-2 py-1.5">置信度: {(status.confidence * 100).toFixed(0)}%</div>
          <div className="rounded-md bg-content2 px-2 py-1.5">信号: {status.signalHz ? `${status.signalHz} Hz` : '--'}</div>
          <div className="rounded-md bg-content2 px-2 py-1.5 col-span-2">最近识别: {formatTimestamp(status.lastDetectedAt)}</div>
        </div>

        {status.lastError && (
          <div className="text-xs text-danger break-all">{status.lastError}</div>
        )}

        <div className="rounded-md border border-default-200 bg-content2 aspect-[4/3] overflow-hidden">
          {latestRxImage ? (
            <img
              src={latestRxImage}
              alt="SSTV RX"
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-default-500">
              等待解码图片...
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-auto rounded-md border border-default-200">
          {latestEvents.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-default-500">
              等待 SSTV VIS 头识别...
            </div>
          ) : (
            <div className="divide-y divide-default-100">
              {latestEvents.map((event, index) => (
                <div key={`${event.type}-${event.timestamp}-${index}`} className="px-2 py-1.5 text-xs">
                  {formatEventLine(event)}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
};
