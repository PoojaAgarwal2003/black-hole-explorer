varying float vAlpha;
varying float vHeat;

void main() {
  float radius = length(gl_PointCoord - 0.5) * 2.0;
  if (radius > 1.0) discard;
  vec3 color = mix(vec3(0.7, 0.24, 0.07), vec3(1.0, 0.83, 0.58), vHeat);
  gl_FragColor = vec4(color * 1.8, (1.0 - radius * radius) * vAlpha);
}
