export const FULL_FILM_CANVAS = Object.freeze({ width: 1920, height: 1080 });

// The eyewear view is the complete film frame. World objects are projected into
// this window; it does not define the limits of the 360-degree encounter.
export const FULL_WIDTH_OPTICAL_FIELD = Object.freeze({
  left: 0,
  top: 0,
  width: FULL_FILM_CANVAS.width,
  height: FULL_FILM_CANVAS.height,
  right: FULL_FILM_CANVAS.width,
  bottom: FULL_FILM_CANVAS.height,
});

// Layout-only guide for the persistent corner information. It is deliberately
// invisible and never clips the Three.js world or the direction indicators.
export const HUD_SAFE_FRAME = Object.freeze({
  left: 312,
  top: 54,
  width: 1296,
  height: 972,
  right: 1608,
  bottom: 1026,
});

// Transitional aliases for modules that still author directly in output
// pixels. They no longer introduce a second coordinate system or CSS zoom.
export const OPTICAL_FIELD_DESIGN = FULL_FILM_CANVAS;
export const OPTICAL_FIELD_SCALE = 1;
