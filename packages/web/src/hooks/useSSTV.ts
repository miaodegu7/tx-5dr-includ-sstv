import * as React from 'react';
import type { SSTVDecoderEvent, SSTVDecoderStatus, SSTVModeName } from '@tx5dr/contracts';
import { useConnection } from '../store/radioStore';

const EMPTY_STATUS: SSTVDecoderStatus = {
  enabled: false,
  state: 'stopped',
  backend: 'vis-heuristic',
  lastDetectedMode: null,
  lastVisCode: null,
  confidence: 0,
  signalHz: null,
  lastDetectedAt: null,
  lastError: null,
};

export function useSSTV() {
  const connection = useConnection();
  const [status, setStatus] = React.useState<SSTVDecoderStatus>(EMPTY_STATUS);
  const [events, setEvents] = React.useState<SSTVDecoderEvent[]>([]);
  const [latestRxImage, setLatestRxImage] = React.useState<string | null>(null);
  const [txState, setTxState] = React.useState<{
    phase: 'idle' | 'preparing' | 'transmitting' | 'done' | 'error';
    message: string;
  }>({
    phase: 'idle',
    message: '等待发送',
  });

  React.useEffect(() => {
    const wsClient = connection.state.radioService?.wsClientInstance;
    if (!wsClient) {
      setStatus(EMPTY_STATUS);
      setEvents([]);
      setLatestRxImage(null);
      setTxState({
        phase: 'idle',
        message: '等待发送',
      });
      return;
    }

    const handleStatus = (data: SSTVDecoderStatus) => {
      setStatus(data);
    };

    const handleEvent = (data: SSTVDecoderEvent) => {
      if (data.type === 'rx_image_decoded') {
        setLatestRxImage(data.imageDataUrl);
      } else if (data.type === 'tx_prepared') {
        setTxState({
          phase: 'preparing',
          message: `已编码 ${data.mode} · ${(data.durationMs / 1000).toFixed(1)}s`,
        });
      } else if (data.type === 'tx_started') {
        setTxState({
          phase: 'transmitting',
          message: `正在发送 ${data.mode}`,
        });
      } else if (data.type === 'tx_completed') {
        setTxState(data.success
          ? {
            phase: 'done',
            message: `发送完成 ${data.mode}`,
          }
          : {
            phase: 'error',
            message: data.error || '发送失败',
          });
      }

      setEvents((previous) => {
        const next = [...previous, data];
        if (next.length > 24) {
          next.splice(0, next.length - 24);
        }
        return next;
      });
    };

    wsClient.onWSEvent('sstvDecoderStatusChanged' as never, handleStatus as never);
    wsClient.onWSEvent('sstvDecoderEvent' as never, handleEvent as never);

    return () => {
      wsClient.offWSEvent('sstvDecoderStatusChanged' as never, handleStatus as never);
      wsClient.offWSEvent('sstvDecoderEvent' as never, handleEvent as never);
    };
  }, [connection.state.radioService]);

  const prepareTx = React.useCallback((payload: {
    imageDataUrl: string;
    callsign?: string;
    mode?: SSTVModeName;
  }) => {
    const wsClient = connection.state.radioService?.wsClientInstance;
    if (!wsClient) {
      return;
    }

    setTxState({
      phase: 'preparing',
      message: '正在准备编码...',
    });
    wsClient.send('sstvTxPrepare' as never, payload as never);
  }, [connection.state.radioService]);

  return {
    status,
    events,
    latestRxImage,
    txState,
    prepareTx,
  };
}

