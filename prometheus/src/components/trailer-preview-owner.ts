let activePreview: { owner: symbol; stop: () => void } | undefined;

export function claimTrailerPreview(owner: symbol, stop: () => void) {
  const previous = activePreview;
  activePreview = { owner, stop };
  if (previous && previous.owner !== owner) previous.stop();
}

export function releaseTrailerPreview(owner: symbol) {
  if (activePreview?.owner === owner) activePreview = undefined;
}
