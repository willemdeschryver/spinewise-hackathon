import vert from './organism.vert?raw';
import frag from './organism.frag?raw';
import type { VisualParams } from './mapping';

export const palette = {
  calm: [0.42, 0.86, 0.78] as const,
  warm: [0.98, 0.64, 0.22] as const,
  hot: [0.86, 0.24, 0.2] as const,
  bg: [0.016, 0.022, 0.034] as const,
};

const UNIFORMS = [
  'u_res', 'u_time', 'u_size', 'u_breath', 'u_split', 'u_agit', 'u_aurora', 'u_grain',
  'u_strain', 'u_voice', 'u_pulse', 'u_shift', 'u_calm', 'u_warm', 'u_hot', 'u_bg',
] as const;
type UniformName = (typeof UNIFORMS)[number];

export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly u = {} as Record<UniformName, WebGLUniformLocation | null>;
  private readonly dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  private width = 0;
  private height = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('This browser has no WebGL2, which the organism needs to draw.');
    this.gl = gl;
    const prog = this.link(vert, frag);
    gl.useProgram(prog);
    for (const name of UNIFORMS) this.u[name] = gl.getUniformLocation(prog, name);
    gl.bindVertexArray(gl.createVertexArray());
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(`Shader failed to compile: ${gl.getShaderInfoLog(sh)}`);
    }
    return sh;
  }

  private link(v: string, f: string): WebGLProgram {
    const gl = this.gl;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, this.compile(gl.VERTEX_SHADER, v));
    gl.attachShader(prog, this.compile(gl.FRAGMENT_SHADER, f));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Shader failed to link: ${gl.getProgramInfoLog(prog)}`);
    }
    return prog;
  }

  resize(): void {
    const w = Math.floor(window.innerWidth * this.dpr);
    const h = Math.floor(window.innerHeight * this.dpr);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  // shiftY moves the body up (positive) or down, in units of the short screen axis.
  render(time: number, p: VisualParams, shiftY = 0): void {
    const gl = this.gl;
    const u = this.u;
    gl.uniform2f(u.u_res, this.width, this.height);
    gl.uniform1f(u.u_time, time);
    gl.uniform1f(u.u_size, p.size);
    gl.uniform1f(u.u_breath, p.breath);
    gl.uniform1f(u.u_split, p.split);
    gl.uniform1f(u.u_agit, p.agit);
    gl.uniform1f(u.u_aurora, p.aurora);
    gl.uniform1f(u.u_grain, p.grain);
    gl.uniform1f(u.u_strain, p.strain);
    gl.uniform1f(u.u_voice, p.voice);
    gl.uniform1f(u.u_pulse, p.pulse);
    gl.uniform2f(u.u_shift, 0, shiftY);
    gl.uniform3fv(u.u_calm, palette.calm);
    gl.uniform3fv(u.u_warm, palette.warm);
    gl.uniform3fv(u.u_hot, palette.hot);
    gl.uniform3fv(u.u_bg, palette.bg);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
