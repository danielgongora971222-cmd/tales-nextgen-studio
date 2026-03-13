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
    description: 'Edit an existing video with Kling O3 Pro (video-to-video).',
    status: 'ready'
  },
  {
    id: 'ingredients-to-video',
    label: 'Ingredients to Video',
    route: AppRoute.TOOL_INGREDIENTS_TO_VIDEO,
    description: 'Generate video from uploaded references (Multishot: intelligence/customize).',
    status: 'ready'
  },
  {
    id: 'extend-video',
    label: 'Extend Video',
    route: AppRoute.TOOL_EXTEND_VIDEO,
    description: 'Extend/transform a base video using reference images.',
    status: 'ready'
  },
  {
    id: 'motion-control',
    label: 'Motion Control',
    route: AppRoute.TOOL_MOTION_CONTROL,
    description: 'Transfer motion from a reference video to a character image with Kling 2.6 or 3.0.',
    status: 'ready'
  }
];
