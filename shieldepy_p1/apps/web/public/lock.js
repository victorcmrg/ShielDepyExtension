// Cadeado 3D da seção "Prova". Sem bibliotecas: um shader WebGL2 descreve o cadeado como uma função de
// distância (corpo arredondado, alça em U, buraco da fechadura) e traça cada pixel por raymarching.
// O acabamento é de gravura: listras no espaço do objeto que engrossam onde a luz não bate, hachura
// cruzada na sombra e contorno na silhueta. Só o buraco da fechadura fica liso, da cor do fundo.
// É desenhado uma vez (pose fixa) e de novo só ao mudar de tamanho ou tema.
(function () {
  const canvas = document.getElementById('lockCanvas');
  if (!canvas) return;
  // tudo do WebGL (contexto, compilação, desenho) nasce só aqui: criar o contexto já custa caro
  function init() {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) {
      canvas.classList.add('no-gl');
      return;
    }

    const VS = `#version 300 es
  in vec2 aPos;
  void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

    const FS = `#version 300 es
  precision highp float;
  uniform vec2 uRes;
  uniform vec3 uRot;   // inclinação (x), giro (y), rolagem (z)
  uniform vec3 uInk;
  uniform vec3 uBg;
  uniform float uDensity;
  out vec4 outColor;

  mat3 M; // mundo -> objeto

  mat3 rx(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 ry(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 rz(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

  float sdRoundBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
  }
  float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
  }
  // buraco da fechadura no plano da frente: círculo + fenda que alarga para baixo
  float keyhole2D(vec2 k) {
    float c = length(k - vec2(0.0, 0.07)) - 0.13;
    float w = 0.045 + max(0.07 - k.y, 0.0) * 0.2;
    float slot = max(abs(k.x) - w, abs(k.y + 0.12) - 0.2);
    return min(c, slot);
  }
  const vec3 BODY = vec3(0.0, -0.36, 0.0);
  float map(vec3 w) {
    vec3 p = M * w;
    vec3 pb = p - BODY;
    float body = sdRoundBox(pb, vec3(0.74, 0.6, 0.32), 0.17);
    float cav = max(keyhole2D(pb.xy), 0.12 - pb.z);
    body = max(body, -cav);
    vec3 ps = p - vec3(0.0, 0.32, 0.0);
    float R = 0.47, r = 0.125;
    float arc = max(length(vec2(length(ps.xy) - R, ps.z)) - r, -ps.y);
    float legs = min(sdCapsule(ps, vec3(-R, 0.0, 0.0), vec3(-R, -0.5, 0.0), r), sdCapsule(ps, vec3(R, 0.0, 0.0), vec3(R, -0.5, 0.0), r));
    return min(body, min(arc, legs));
  }
  vec3 calcNormal(vec3 p) {
    const vec2 e = vec2(1.0, -1.0) * 0.0007;
    return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
  }
  float stripes(float s, float w) {
    float fw = fwidth(s);
    float v = abs(fract(s) - 0.5) * 2.0;
    return smoothstep(1.0 - w - fw, 1.0 - w + fw, v);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
    M = transpose(rz(uRot.z) * ry(uRot.y) * rx(uRot.x));
    vec3 ro = vec3(0.0, 0.0, 5.9);
    vec3 rd = normalize(vec3(uv, -2.0));
    // esfera que envolve o cadeado: raio que não passa por ela é fundo, sem marchar nada
    float b = dot(ro, rd);
    float h = b * b - (dot(ro, ro) - 1.32 * 1.32);
    if (h < 0.0) { outColor = vec4(0.0); return; }
    h = sqrt(h);
    float t = max(-b - h, 0.0), tEnd = -b + h, minD = 1e9;
    bool hit = false;
    for (int i = 0; i < 80; i++) {
      float d = map(ro + rd * t);
      minD = min(minD, d);
      if (d < 0.0007 * t) { hit = true; break; }
      t += d;
      if (t > tEnd) break;
    }
    float pix = 1.6 / uRes.y; // tamanho aproximado de um pixel em z = 0
    if (!hit) {
      float a = 1.0 - smoothstep(pix * 0.6, pix * 2.2, minD);
      outColor = vec4(uInk * a, a);
      return;
    }
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    vec3 q = M * p;
    vec3 L = normalize(vec3(-0.55, 0.7, 0.55));
    float dif = clamp(dot(n, L), 0.0, 1.0);
    float shade = 0.12 + 0.88 * dif;
    float facing = abs(dot(n, -rd));
    // gravura: listras no espaço do objeto, mais grossas onde é mais escuro
    float s1 = (q.y * 0.92 + q.x * 0.2 + q.z * 0.22) * uDensity;
    float line = stripes(s1, mix(0.06, 0.7, pow(1.0 - shade, 1.4)));
    float w2 = clamp((0.3 - shade) * 1.6, 0.0, 0.4);
    float s2 = (q.x * 0.95 - q.y * 0.32) * uDensity;
    line = max(line, stripes(s2, w2) * step(0.001, w2));
    line = max(line, smoothstep(0.3, 0.12, facing)); // contorno das bordas que viram de lado
    vec3 pb = q - BODY;
    bool inKey = keyhole2D(pb.xy) < 0.006 && pb.z < 0.33;
    // o buraco da fechadura fica liso, da cor do fundo; o resto é todo listrado
    vec3 col = inKey ? uBg : mix(uBg, uInk, line);
    outColor = vec4(col, 1.0);
  }`;

    function shader(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    }
    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
    } catch (e) {
      console.warn('ShielDepy: cadeado 3D indisponível', e);
      canvas.classList.add('no-gl');
      return;
    }
    const parallel = gl.getExtension('KHR_parallel_shader_compile');
    const U = {};
    function setup() {
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn('ShielDepy: cadeado 3D indisponível', gl.getProgramInfoLog(prog));
        canvas.classList.add('no-gl');
        return false;
      }
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      ['uRes', 'uRot', 'uInk', 'uBg', 'uDensity'].forEach((n) => (U[n] = gl.getUniformLocation(prog, n)));
      return true;
    }

    // cores vêm do CSS (mudam com o tema)
    const rgb = (str) => (str.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map((v) => Number(v) / 255);
    function readColors() {
      const cs = getComputedStyle(canvas);
      gl.uniform3fv(U.uInk, rgb(cs.color));
      gl.uniform3fv(U.uBg, rgb(getComputedStyle(document.body).backgroundColor));
    }
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(U.uRes, w, h);
      // listras com espessura parecida em qualquer tamanho
      gl.uniform1f(U.uDensity, Math.max(12, Math.min(17, canvas.clientWidth / 32)));
    }

    // pose fixa: levemente inclinado, como o cadeado da referência (não segue o mouse nem gira)
    const ROT = { x: 0.16, y: -0.42, z: 0.4 };
    function draw() {
      gl.uniform3f(U.uRot, ROT.x, ROT.y, ROT.z);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // espera o compilador do driver terminar (sem bloquear a página) e desenha num momento ocioso
    function whenReady(cb) {
      if (parallel && !gl.getProgramParameter(prog, parallel.COMPLETION_STATUS_KHR)) {
        requestAnimationFrame(() => whenReady(cb));
        return;
      }
      (window.requestIdleCallback || ((f) => setTimeout(f, 1)))(cb, { timeout: 300 });
    }
    function start() {
      whenReady(begin);
    }
    function begin() {
      if (!setup()) return;
      resize();
      readColors();
      draw();
      new ResizeObserver(() => {
        resize();
        draw();
      }).observe(canvas);
      new MutationObserver(() => {
        readColors();
        draw();
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    start();
  }

  // compila e desenha só quando a seção chega perto da tela (não pesa no carregamento do topo)
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      init();
    }, { rootMargin: '600px 0px' });
    io.observe(canvas);
  } else init();
})();
