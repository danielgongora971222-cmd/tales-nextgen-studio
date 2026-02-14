import { AppRoute } from '../types';
import type { ToolDefinition } from './tools';

export const VIDEO_TOOLS_REGISTRY: ToolDefinition[] = [
  {
    id: 'video-generator',
    label: 'General Video Generator',
    route: AppRoute.TOOL_VIDEO_GENERATOR,
    description: 'Text-to-video generation with multi-model support.',
    status: 'ready'
  },
  {
    id: 'video-edit',
    label: 'Edit Video',
    route: AppRoute.TOOL_VIDEO_EDIT,
    description: 'Edit and enhance an existing video (trim, upscale, AI edits).',
    status: 'coming_soon'
  },
  {
    id: 'motion-control',
    label: 'Motion Control',
    route: AppRoute.TOOL_MOTION_CONTROL,
    description: 'Direct camera moves and motion paths for cinematic control.',
    status: 'beta'
  }
];
