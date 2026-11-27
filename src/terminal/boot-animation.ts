import { BufferGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Path, PerspectiveCamera, Scene, TorusGeometry, Vector3, WebGLRenderer } from 'three';

function tugboatLogoGeometry(): BufferGeometry {
  // The shield and terminal prompt from tugboat-logo-1024.png.
  const shield = new Path();
  shield.moveTo(0, 0.52);
  shield.bezierCurveTo(0.12, 0.41, 0.26, 0.35, 0.41, 0.35);
  shield.bezierCurveTo(0.48, -0.04, 0.37, -0.35, 0, -0.52);
  shield.bezierCurveTo(-0.37, -0.35, -0.48, -0.04, -0.41, 0.35);
  shield.bezierCurveTo(-0.26, 0.35, -0.12, 0.41, 0, 0.52);

  const outline = shield.getPoints();
  const rim = outline.slice(1).flatMap((end, index) => {
    const start = outline[index];
    return [
      new Vector3(start.x, start.y, 0.05), new Vector3(end.x, end.y, 0.05),
      new Vector3(start.x * 0.8, start.y * 0.8, 0), new Vector3(end.x * 0.8, end.y * 0.8, 0),
    ];
  });
  const prompt = [
    new Vector3(-0.15, 0.13, 0), new Vector3(-0.045, 0.045, 0),
    new Vector3(-0.045, 0.045, 0), new Vector3(-0.15, -0.04, 0),
    new Vector3(0, -0.06, 0), new Vector3(0.16, -0.06, 0),
  ];
  return new BufferGeometry().setFromPoints([...rim, ...prompt]);
}

export function startBootAnimation(canvas: HTMLCanvasElement): () => void {
  const view = canvas.ownerDocument.defaultView!;
  if (!view.WebGL2RenderingContext) return () => {};
  let renderer: WebGLRenderer;
  try { renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' }); }
  catch {
    console.warn('Could not render the environment boot animation.');
    return () => {};
  }

  const reducedMotion = view.matchMedia('(prefers-reduced-motion: reduce)');
  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 10);
  camera.position.z = 3.6;
  const model = new Group();
  const logoGeometry = tugboatLogoGeometry();
  const logoMaterial = new LineBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.7 });
  const logo = new LineSegments(logoGeometry, logoMaterial);
  const ringGeometry = new TorusGeometry(0.94, 0.008, 4, 96);
  const ringMaterial = new MeshBasicMaterial({ color: 0xbcbcbc, transparent: true, opacity: 0.55, depthWrite: false });
  const rings = [0, 1, 2].map(index => {
    const ring = new Mesh(ringGeometry, ringMaterial);
    ring.rotation.set(0.65 + index * 0.7, index * Math.PI / 3, index * 0.3);
    return ring;
  });
  model.add(logo, ...rings);
  scene.add(model);
  let stopped = false;

  function render(time: number): void {
    if (stopped) return;
    model.rotation.x = 0.2 + Math.sin(time * 0.0003) * 0.12;
    model.rotation.y = time * 0.00022;
    // Keep the terminal prompt readable while the rings turn around it.
    logo.rotation.y = Math.sin(time * 0.00045) * 0.55 - model.rotation.y;
    renderer.render(scene, camera);
  }

  function resize(): void {
    if (stopped) return;
    const width = canvas.clientWidth || 200;
    const height = canvas.clientHeight || 200;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    renderer.render(scene, camera);
  }

  function updateMotion(): void {
    if (stopped) return;
    renderer.setAnimationLoop(reducedMotion.matches ? null : render);
    render(0);
  }

  renderer.setPixelRatio(Math.min(view.devicePixelRatio, 2));
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  reducedMotion.addEventListener('change', updateMotion);
  resize();
  updateMotion();

  return () => {
    if (stopped) return;
    stopped = true;
    renderer.setAnimationLoop(null);
    observer.disconnect();
    reducedMotion.removeEventListener('change', updateMotion);
    logoGeometry.dispose(); ringGeometry.dispose();
    logoMaterial.dispose(); ringMaterial.dispose();
    scene.clear();
    renderer.dispose();
  };
}
