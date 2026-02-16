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
    description: 'Edit videos with Kling O3 Pro (video-to-video, reference, and reference-to-video).',
    status: 'ready'
  },
  {
    id: 'motion-control',
    label: 'Motion Control',
    route: AppRoute.TOOL_MOTION_CONTROL,
    description: 'Direct camera moves and motion paths for cinematic control.',
    status: 'ready'
  }
];
