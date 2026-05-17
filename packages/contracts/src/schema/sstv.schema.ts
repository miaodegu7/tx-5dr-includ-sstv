import { z } from 'zod';

export const SSTVModeNameSchema = z.enum([
  'MartinM1',
  'MartinM2',
  'ScottieS1',
  'ScottieS2',
  'ScottieDX',
  'Robot36',
  'Robot72',
  'PD90',
  'PD120',
  'PD180',
  'PD240',
  'Unknown',
]);

export type SSTVModeName = z.infer<typeof SSTVModeNameSchema>;

export const SSTVDecoderStatusSchema = z.object({
  enabled: z.boolean(),
  state: z.enum(['stopped', 'running', 'error']),
  backend: z.string(),
  lastDetectedMode: SSTVModeNameSchema.nullable(),
  lastVisCode: z.number().int().nullable(),
  confidence: z.number().min(0).max(1),
  signalHz: z.number().nullable(),
  lastDetectedAt: z.number().nullable(),
  lastError: z.string().nullable(),
});

export type SSTVDecoderStatus = z.infer<typeof SSTVDecoderStatusSchema>;

export const SSTVDecoderEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('vis_detected'),
    mode: SSTVModeNameSchema,
    visCode: z.number().int(),
    confidence: z.number().min(0).max(1),
    signalHz: z.number().nullable().optional(),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal('sync_detected'),
    confidence: z.number().min(0).max(1),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal('rx_image_decoded'),
    mode: SSTVModeNameSchema,
    imageDataUrl: z.string().min(1),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    confidence: z.number().min(0).max(1).optional(),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal('tx_prepared'),
    mode: SSTVModeNameSchema,
    callsign: z.string(),
    durationMs: z.number().positive(),
    sampleRate: z.number().int().positive(),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal('tx_started'),
    mode: SSTVModeNameSchema,
    callsign: z.string(),
    durationMs: z.number().positive(),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal('tx_completed'),
    mode: SSTVModeNameSchema,
    callsign: z.string(),
    success: z.boolean(),
    durationMs: z.number().positive().optional(),
    error: z.string().optional(),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal('error'),
    error: z.string(),
    recoverable: z.boolean().default(true),
    timestamp: z.number(),
  }),
]);

export type SSTVDecoderEvent = z.infer<typeof SSTVDecoderEventSchema>;

export const SSTVTxPreparePayloadSchema = z.object({
  imageDataUrl: z.string().min(1),
  callsign: z.string().trim().max(32).optional(),
  mode: SSTVModeNameSchema.optional(),
});

export type SSTVTxPreparePayload = z.infer<typeof SSTVTxPreparePayloadSchema>;

