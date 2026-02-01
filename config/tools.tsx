import React from 'react';
import { AppRoute } from '../types';

export interface ToolDefinition {
  id: string;
  label: string;
  route: AppRoute;
  description: string;
  status: 'ready' | 'beta' | 'coming_soon';
}

export const TOOLS_REGISTRY: ToolDefinition[] = [
  {
    id: 'generator',
    label: 'Standard Generator',
    route: AppRoute.TOOL_GENERATOR,
    description: 'Fast and efficient text-to-image generation.',
    status: 'ready'
  },
  {
    id: 'editor',
    label: 'Editor AI Pro',
    route: AppRoute.TOOL_EDITOR,
    description: 'Advanced controls: Seed, Steps, Negative Prompts.',
    status: 'ready'
  },
  {
    id: 'restyler',
    label: 'Restyler',
    route: AppRoute.TOOL_RESTYLER,
    description: 'Transform existing images into new styles.',
    status: 'ready'
  },
  {
    id: 'faceswap',
    label: 'Face Swap',
    route: AppRoute.TOOL_FACESWAP,
    description: 'Replace faces in target images with source identity.',
    status: 'beta'
  },
  {
    id: 'upscaler',
    label: 'Upscaler',
    route: AppRoute.TOOL_UPSCALER,
    description: 'Enhance resolution and add details.',
    status: 'ready'
  },
  {
    id: 'angles',
    label: 'Camera Angles',
    route: AppRoute.TOOL_ANGLES,
    description: 'Generate specific cinematic shots and perspectives.',
    status: 'ready'
  },
  {
    id: 'collage',
    label: 'Collage Maker',
    route: AppRoute.TOOL_COLLAGE,
    description: 'Compose multiple generations into a single layout.',
    status: 'beta'
  }
];