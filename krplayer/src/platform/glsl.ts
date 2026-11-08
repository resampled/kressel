// GameMaker ships shaders as GLSL ES 1.00. Desktop GM runs them through HLSL, which lacks ES 1.00's Appendix A
// limits (e.g. `for (float i = corner.y; i < u.w; ...)` is legal there), so WebGL2 compiles them as GLSL ES 3.00 instead.

// Names free in 1.00 but reserved in 3.00 (`uniform sampler2D texture;` is common). Calls to them are left alone.
const GLSL3_RESERVED = /\b(texture|centroid|smooth|layout|uint|uvec[234])\b(?!\s*\()/g;

/** Rewrites a GLSL ES 1.00 shader as 3.00. Source that already declares a 3.00 version is returned unchanged. */
export function glslTo300(src: string, fragment: boolean): string {
  if (/^\s*#version\s+300\b/.test(src)) return src;
  let s = src.replace(/^\s*#version[^\n]*\n?/, '').replace(GLSL3_RESERVED, '$1_')
    .replace(/\btexture2D(Lod)?\b|\btextureCube(Lod)?\b/g, (_m, a, b) => (a || b ? 'textureLod' : 'texture'))
    .replace(/\btexture2DProj\b/g, 'textureProj')
    .replace(/\battribute\b/g, 'in')
    .replace(/\bvarying\b/g, fragment ? 'in' : 'out');
  if (!fragment) return `#version 300 es\n${s}`;
  s = s.replace(/\bgl_FragColor\b|\bgl_FragData\s*\[\s*0\s*\]/g, 'gm_FragColor');
  // 3.00 fragment shaders have no default float precision; the source's own `precision` line still wins.
  return `#version 300 es\nprecision mediump float;\nout vec4 gm_FragColor;\n${s}`;
}
