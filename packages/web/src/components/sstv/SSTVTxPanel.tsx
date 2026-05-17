import * as React from 'react';
import { Button, Card, CardBody, Input, Select, SelectItem } from '@heroui/react';
import type { SSTVModeName } from '@tx5dr/contracts';
import { useSSTV } from '../../hooks/useSSTV';

const TX_MODES: SSTVModeName[] = [
  'MartinM1',
  'MartinM2',
  'ScottieS1',
  'ScottieS2',
  'Robot36',
  'Robot72',
  'PD90',
  'PD120',
  'PD180',
  'PD240',
];

const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 480;

function drawPreview(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement | null,
  callsign: string,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

  if (image) {
    const scale = Math.min(PREVIEW_WIDTH / image.width, PREVIEW_HEIGHT / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const x = (PREVIEW_WIDTH - drawWidth) / 2;
    const y = (PREVIEW_HEIGHT - drawHeight) / 2;
    ctx.drawImage(image, x, y, drawWidth, drawHeight);
  }

  if (callsign.trim()) {
    ctx.font = 'bold 34px sans-serif';
    ctx.textBaseline = 'bottom';
    const text = callsign.trim().toUpperCase();
    const padding = 14;
    const metrics = ctx.measureText(text);
    const boxHeight = 44;
    const boxY = PREVIEW_HEIGHT - boxHeight - 10;
    const boxWidth = Math.min(PREVIEW_WIDTH - 20, metrics.width + padding * 2);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
    ctx.fillRect(10, boxY, boxWidth, boxHeight);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 10 + padding, PREVIEW_HEIGHT - 16);
  }
}

export const SSTVTxPanel: React.FC = () => {
  const { prepareTx, txState } = useSSTV();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [callsign, setCallsign] = React.useState('');
  const [mode, setMode] = React.useState<SSTVModeName>('MartinM1');
  const [image, setImage] = React.useState<HTMLImageElement | null>(null);
  const [imageName, setImageName] = React.useState('');

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawPreview(canvas, image, callsign);
  }, [image, callsign]);

  const handleSelectImage = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const source = reader.result;
      if (typeof source !== 'string') {
        return;
      }
      const nextImage = new Image();
      nextImage.onload = () => {
        setImage(nextImage);
        setImageName(file.name);
      };
      nextImage.src = source;
    };
    reader.readAsDataURL(file);
  }, []);

  const handlePrepare = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const imageDataUrl = canvas.toDataURL('image/png');
    prepareTx({
      imageDataUrl,
      callsign: callsign.trim(),
      mode,
    });
  }, [callsign, mode, prepareTx]);

  return (
    <Card shadow="sm" className="h-full min-h-0 overflow-hidden">
      <CardBody className="h-full p-3 md:p-4 flex flex-col gap-3 min-h-0">
        <div className="text-sm font-semibold">SSTV TX</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Input
            size="sm"
            label="呼号"
            placeholder="例如: BG5DRB"
            value={callsign}
            onValueChange={setCallsign}
          />
          <Select
            size="sm"
            label="SSTV 模式"
            selectedKeys={[mode]}
            onSelectionChange={(keys) => {
              if (keys === 'all') {
                return;
              }
              const key = Array.from(keys)[0] as SSTVModeName | undefined;
              if (key) {
                setMode(key);
              }
            }}
          >
            {TX_MODES.map((item) => (
              <SelectItem key={item} textValue={item}>
                {item}
              </SelectItem>
            ))}
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button as="label" size="sm" variant="flat" color="primary">
            选择图片
            <input type="file" accept="image/*" hidden onChange={handleSelectImage} />
          </Button>
          <div className="text-xs text-default-500 truncate">{imageName || '未选择图片'}</div>
        </div>

        <div className="flex-1 min-h-0 rounded-md border border-default-200 overflow-hidden bg-content2">
          <canvas
            ref={canvasRef}
            width={PREVIEW_WIDTH}
            height={PREVIEW_HEIGHT}
            className="h-full w-full object-contain"
          />
        </div>

        <div className="flex justify-end">
          <Button
            size="sm"
            color="primary"
            onPress={handlePrepare}
            isDisabled={!image || txState.phase === 'preparing' || txState.phase === 'transmitting'}
          >
            {txState.phase === 'transmitting' ? '发送中...' : '准备发送'}
          </Button>
        </div>

        <div className="text-xs text-default-500 text-right">
          {txState.message}
        </div>
      </CardBody>
    </Card>
  );
};

