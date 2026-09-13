import { useEffect, useRef, useState } from 'react';

// Decorative, lazy-loaded scene. File transfers never depend on WebGL.
export default function GlassSculpture({ motionEnabled }) {
  const host = useRef(null);
  const enabled = useRef(motionEnabled);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    enabled.current = motionEnabled;
  }, [motionEnabled]);
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    async function mount() {
      const [THREE, { RoomEnvironment }, { RoundedBoxGeometry }] = await Promise.all([
        import('three'),
        import('three/addons/environments/RoomEnvironment.js'),
        import('three/addons/geometries/RoundedBoxGeometry.js'),
      ]);
      if (disposed || !host.current) return;
      const container = host.current;
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'low-power',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      container.appendChild(renderer.domElement);
      cleanup = () => {
        renderer.dispose();
        renderer.domElement.remove();
      };
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
      camera.position.set(0, 0, 9.3);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      const environment = pmrem.fromScene(room, 0.04);
      scene.environment = environment.texture;
      room.dispose();
      pmrem.dispose();
      const sculpture = new THREE.Group();
      scene.add(sculpture);
      const chrome = new THREE.MeshStandardMaterial({
        color: '#c4d0db',
        metalness: 1,
        roughness: 0.19,
      });
      const glass = new THREE.MeshPhysicalMaterial({
        color: '#c8e3ef',
        metalness: 0.05,
        roughness: 0.16,
        transmission: 0.86,
        thickness: 0.65,
        ior: 1.45,
        transparent: true,
        opacity: 1,
        clearcoat: 1,
      });
      const pearl = new THREE.MeshStandardMaterial({
        color: '#e4edf3',
        metalness: 0.65,
        roughness: 0.24,
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.68, 0.19, 24, 100), chrome);
      ring.rotation.set(0.58, -0.43, -0.44);
      sculpture.add(ring);
      const glassRing = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.055, 12, 100), glass);
      glassRing.rotation.set(-0.55, 0.28, 0.35);
      sculpture.add(glassRing);
      const file = new THREE.Group();
      file.rotation.set(-0.12, -0.34, -0.2);
      file.position.z = 0.38;
      sculpture.add(file);
      const slabGeometry = new RoundedBoxGeometry(1.53, 1.98, 0.13, 5, 0.13);
      const back = new THREE.Mesh(slabGeometry, pearl);
      back.position.set(0.17, 0.17, -0.27);
      back.rotation.z = -0.13;
      file.add(back);
      file.add(new THREE.Mesh(slabGeometry, glass));
      // A file glyph embedded on the face, built from geometry instead of an image.
      const ink = new THREE.MeshStandardMaterial({
        color: '#f5fbff',
        metalness: 0.3,
        roughness: 0.3,
      });
      const lineGeometry = new RoundedBoxGeometry(0.72, 0.025, 0.018, 2, 0.01);
      for (let i = 0; i < 3; i++) {
        const line = new THREE.Mesh(lineGeometry, ink);
        line.position.set(-0.13, -0.35 - i * 0.12, 0.085);
        line.scale.x = i === 2 ? 0.65 : 1;
        file.add(line);
      }
      const arrow = new THREE.Group();
      arrow.add(new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.57, 0.045, 3, 0.025), ink));
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.31, 0.045, 3, 0.025), ink);
        arm.rotation.z = (side * Math.PI) / 4;
        arm.position.set(side * 0.1, 0.18, 0);
        arrow.add(arm);
      }
      arrow.position.set(0, 0.27, 0.105);
      arrow.rotation.z = -Math.PI / 4;
      file.add(arrow);
      const orbGeometry = new THREE.SphereGeometry(0.15, 24, 16);
      const orb = new THREE.Mesh(orbGeometry, chrome);
      orb.position.set(1.85, 0.91, 0.4);
      sculpture.add(orb);
      const orb2 = new THREE.Mesh(orbGeometry, pearl);
      orb2.scale.setScalar(0.6);
      orb2.position.set(-1.7, -1.25, 0.4);
      sculpture.add(orb2);
      scene.add(new THREE.HemisphereLight('#e4f0ff', '#4b5160', 2));
      const key = new THREE.DirectionalLight('#e5f3ff', 4);
      key.position.set(-3, 4, 5);
      scene.add(key);
      let visible = true;
      let dirty = true;
      let frame;
      let last = 0;
      let elapsed = 0;
      let x = 0;
      let y = 0;
      const resize = new ResizeObserver(() => {
        const { width, height } = container.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        dirty = true;
      });
      resize.observe(container);
      const observer = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
      });
      observer.observe(container);
      const pointer = (event) => {
        if (event.pointerType === 'touch') return;
        const rect = container.getBoundingClientRect();
        x = ((event.clientX - rect.left) / rect.width - 0.5) * 0.35;
        y = ((event.clientY - rect.top) / rect.height - 0.5) * 0.22;
      };
      const leave = () => {
        x = 0;
        y = 0;
      };
      container.addEventListener('pointermove', pointer);
      container.addEventListener('pointerleave', leave);
      const contextLost = (event) => {
        event.preventDefault();
        visible = false;
        setReady(false);
      };
      renderer.domElement.addEventListener('webglcontextlost', contextLost);
      function tick(time) {
        frame = requestAnimationFrame(tick);
        const delta = Math.min(time - last, 50);
        if (time - last < 1000 / 30) return;
        last = time;
        if (!visible || document.hidden || (!enabled.current && !dirty)) return;
        if (enabled.current) {
          elapsed += delta / 1000;
          sculpture.rotation.y += (x - sculpture.rotation.y) * 0.045;
          sculpture.rotation.x += (y - sculpture.rotation.x) * 0.045;
          sculpture.position.y = Math.sin(elapsed * 0.65) * 0.1;
          ring.rotation.z = -0.44 + Math.sin(elapsed * 0.22) * 0.15;
        }
        renderer.render(scene, camera);
        dirty = false;
      }
      cleanup = () => {
        cancelAnimationFrame(frame);
        resize.disconnect();
        observer.disconnect();
        container.removeEventListener('pointermove', pointer);
        container.removeEventListener('pointerleave', leave);
        renderer.domElement.removeEventListener('webglcontextlost', contextLost);
        const geometries = new Set();
        scene.traverse((object) => {
          if (object.geometry) geometries.add(object.geometry);
        });
        geometries.forEach((geometry) => geometry.dispose());
        [chrome, glass, pearl, ink].forEach((material) => material.dispose());
        environment.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
      frame = requestAnimationFrame(tick);
      setReady(true);
    }
    mount().catch(() => {
      if (!disposed) {
        cleanup();
        setReady(false);
      }
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);
  return (
    <div className="glass-sculpture" ref={host} data-ready={ready}>
      {!ready && (
        <div className="sculpture-fallback">
          <div className="fallback-ring" />
          <div className="fallback-file">
            ↗<span />
            <span />
            <span />
          </div>
        </div>
      )}
    </div>
  );
}
