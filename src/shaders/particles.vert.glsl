attribute float aSeed;
uniform float uTime;
uniform float uGravity;
uniform float uSpin;
uniform float uPixelRatio;
varying float vAlpha;
varying float vHeat;

void main() {
  float lifetime = 16.0 + aSeed * 14.0;
  float progress = fract(position.x - uTime / lifetime);
  float radius = (1.1 + progress * 10.5) * uGravity;
  float angle = position.y + uTime * (0.14 + abs(uSpin) * 0.3) * sign(uSpin + 0.001)
              + (1.0 - progress) * 9.0;
  float height = position.z * (0.03 + progress * 0.35) * uGravity;
  vec3 point = vec3(cos(angle) * radius, height, sin(angle) * radius);
  vec4 viewPosition = modelViewMatrix * vec4(point, 1.0);
  gl_Position = projectionMatrix * viewPosition;
  gl_PointSize = clamp((0.6 + aSeed * 1.6) * uPixelRatio * 24.0 / -viewPosition.z, 0.5, 4.0);
  vAlpha = smoothstep(0.0, 0.12, progress) * (1.0 - smoothstep(0.8, 1.0, progress)) * 0.5;
  vHeat = 1.0 - progress;
}
