import React from "react";
import { AppRoute, Asset } from "../types";
import StoreNewUI from "./StoreNewUI";

type StorePrefill = { asset?: Asset | null };

interface StoreProps {
  onNavigate: (route: AppRoute) => void;
  prefill?: StorePrefill;
  onRequestUpscale?: (asset: Asset) => void;
}

const Store: React.FC<StoreProps> = ({ onNavigate, onRequestUpscale, prefill }) => {
  return (
    <StoreNewUI
      onNavigate={onNavigate}
      onRequestUpscale={onRequestUpscale}
      prefill={prefill}
    />
  );
};

export default Store;