#version 300 es
precision highp float;

out vec4 outColor;

uniform vec2  u_res;
uniform float u_time;
uniform float u_size;     // radius as a fraction of the short screen axis
uniform float u_breath;   // -1..1, already scaled by pace
uniform float u_split;    // 0..1 two lobes pulling apart (people talking over each other)
uniform float u_agit;     // 0..1 edge turbulence
uniform float u_aurora;   // 0..1 poor clarity as an aurora around the body
uniform float u_grain;    // 0..1 surface grit
uniform float u_strain;   // 0..1 overall colour shift
uniform float u_voice;    // 0..1 someone is speaking
uniform float u_pulse;    // 0..1 decaying burst after a loud onset
uniform vec2  u_shift;    // where the body sits, in short-axis units from the centre
uniform vec3  u_calm;
uniform vec3  u_warm;
uniform vec3  u_hot;
uniform vec3  u_bg;

// Simplex noise, Ashima Arts / Stefan Gustavson (MIT).
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * snoise(p);
    p = p * 2.02 + vec2(13.7, 7.3);
    a *= 0.5;
  }
  return s;
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

void main() {
  float minAxis = min(u_res.x, u_res.y);
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / minAxis;
  float t = u_time;

  // The body never sits dead still.
  vec2 drift = 0.025 * vec2(snoise(vec2(t * 0.05, 3.1)), snoise(vec2(t * 0.045, 9.7)));
  vec2 p = uv - drift - u_shift;

  float r = max(u_size * (1.0 + 0.06 * u_breath), 0.03);
  float ang = 0.5 + 0.35 * sin(t * 0.09);
  vec2 ax = vec2(cos(ang), sin(ang));
  float sep = u_split * r * 1.15;
  float rl = r * (1.0 - 0.3 * u_split);
  vec2 c1 = ax * sep;
  vec2 c2 = -ax * sep;
  float d1 = length(p - c1) - rl;
  float d2 = length(p - c2) - rl * 0.9;
  float d = smin(d1, d2, r * 0.25);

  // Organic rim: a slow swell plus a fine ripple that grows with agitation.
  vec2 q = p / r;
  float n1 = fbm(q * 1.4 + vec2(t * 0.10, -t * 0.07));
  float n2 = fbm(q * 4.5 + vec2(-t * 0.55, t * 0.40));
  d += r * (0.10 + 0.14 * u_agit) * n1;
  d += r * (0.02 + 0.30 * u_agit) * n2 * 0.5;

  float edge = 0.006 + 0.012 * u_agit;
  float body = 1.0 - smoothstep(-edge, edge, d);
  float depth = max(-d, 0.0);
  float rim = exp(-depth / (0.05 * r + 0.004));
  float cdist = min(length(p - c1), length(p - c2)) / max(rl, 0.02);
  float core = exp(-cdist * cdist * 2.2);

  // Stays clearly calm until strain is real, then warms, then goes hot.
  vec3 tint = mix(u_calm, u_warm, smoothstep(0.22, 0.65, u_strain));
  tint = mix(tint, u_hot, smoothstep(0.6, 1.0, u_strain));
  vec3 pale = mix(tint, vec3(1.0), 0.72);

  vec3 bodyCol = tint * (0.28 + 0.55 * rim);
  bodyCol += pale * core * (0.55 + 0.35 * u_voice);
  bodyCol += pale * core * u_pulse * 0.35;

  float outside = max(d, 0.0);
  float halo = exp(-outside * 3.0 / r) * 0.28 + exp(-outside * 90.0) * 0.18;
  vec3 col = u_bg;
  col += tint * halo * (0.7 + 0.3 * u_voice);

  // Poor clarity lights an aurora: curtains of light that hang around the body and
  // radiate outward, so a tablet flat on the table reads the same from every seat.
  // A clear room keeps the sky dark and still; the worse it gets, the wider, faster
  // and brighter the curtains, so the bad state is the one that draws the eye.
  float aur = 0.0;
  vec3 aurCol = tint;
  if (u_aurora > 0.002) {
    float rad = length(p);
    vec2 ring = p / max(rad, 1e-4);
    float sp = 0.5 + 1.5 * u_aurora;
    float away = outside / r;
    // Where the curtain hangs around the circle, drifting slowly; wider when it is bad.
    float c1 = snoise(ring * 2.0 + vec2(t * 0.06 * sp, 0.0));
    float c2 = snoise(ring * 5.0 + away * 1.2 + vec2(-t * 0.11 * sp, 4.0));
    float lo = 0.35 - 0.55 * u_aurora;
    float curtain = smoothstep(lo, 0.9, 0.55 * c1 + 0.45 * c2);
    // Rays along the radius, folded like a curtain, shimmering faster as clarity drops.
    float ry = snoise(ring * 11.0 + away * 0.8 + vec2(t * 0.35 * sp, -t * 0.2 * sp));
    float fold = snoise(ring * 3.5 + away * 2.2 + vec2(-t * 0.15 * sp, 8.0));
    float rays = (0.55 + 0.45 * smoothstep(-0.6, 0.8, ry)) * (0.65 + 0.35 * fold);
    // Sits just outside the body and fades with distance, reaching further when it is bad.
    float reach = exp(-away / (0.5 + 1.6 * u_aurora));
    aur = u_aurora * curtain * rays * reach;
    // The strain colour at the foot, violet at the top, like the real thing.
    aurCol = mix(tint, mix(tint, vec3(0.55, 0.3, 0.95), 0.55), smoothstep(0.1, 1.6, away));
  }
  col += aurCol * aur * 1.1;
  bodyCol += aurCol * rim * aur * 0.5;
  col = mix(col, bodyCol, body);

  // Grain: fine film grain everywhere, coarse grit on the body when the room is noisy.
  float g = hash(gl_FragCoord.xy + fract(t) * vec2(97.0, 311.0)) - 0.5;
  col += g * (0.018 + 0.16 * u_grain * body);
  float gc = hash(floor(gl_FragCoord.xy / 3.0) + floor(t * 24.0)) - 0.5;
  col += gc * 0.10 * u_grain * body;

  float vig = smoothstep(1.15, 0.25, length(uv));
  col *= 0.75 + 0.25 * vig;

  // A ring runs out from the body after a loud onset.
  float ringR = r * (1.1 + 1.4 * (1.0 - u_pulse));
  float ring = exp(-abs(length(p) - ringR) * 80.0) * u_pulse * u_pulse * 0.3;
  col += tint * ring;

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
