import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion';

export default function TiltCard({ children, className = '', ...props }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const reduced = useReducedMotion();
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [2, -2]), { stiffness: 180, damping: 24 });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-2, 2]), { stiffness: 180, damping: 24 });
  return (
    <motion.div
      className={className}
      style={{ rotateX, rotateY, transformPerspective: 1000 }}
      onPointerMove={(e) => {
        if (reduced || e.pointerType !== 'mouse') return;
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left) / r.width - 0.5);
        y.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
