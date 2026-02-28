import React from "react";
import { AppRoute, Asset } from "../types";
import StoreNewUI from "./StoreNewUI";

type StorePrefill = { asset?: Asset | null };

interface StoreProps {
  onNavigate: (route: AppRoute) => void;
  prefill?: StorePrefill;
  onRequestUpscale?: (asset: Asset) => void;
}

const Store: React.FC<StoreProps> = ({ onNavigate, onRequestUpscale }) => {
  return <StoreNewUI onNavigate={onNavigate} onRequestUpscale={onRequestUpscale} />;
};

export default Store;