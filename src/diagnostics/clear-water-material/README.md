# Clear-water material diagnostic

This is an isolated forward-action material experiment. It intentionally does
not import or modify the production Blender preview loader.

Design constraints:

- The body remains in the opaque render pass (`transparent: false`,
  `opacity: 1`, `depthWrite: true`) so rear/tail geometry cannot alpha-blend
  through the torso.
- Water clarity comes from physical transmission and volume attenuation.
- Continuous skin-weight regions blend body, wing, and tail transmission and
  absorption inside one physical material. This keeps the body pale cyan while
  thin wings stay close to clear water, without hard seams or directional bands.
- The normal map is low-amplitude periodic fBm rather than directional sine
  bands, so it only breaks close highlights.
- A small Fresnel contribution supplies a silver-white rim without a second
  transparent shell.

The recommended runtime profile is exported by the diagnostic page as
`window.waterwingClearWaterLab.getState().materialProfile`.
