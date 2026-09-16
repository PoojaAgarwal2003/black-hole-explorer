precision highp float;

varying vec2 vUv;
uniform vec2 uResolution;
uniform vec3 uCameraPosition;
uniform mat4 uCameraWorld;
uniform mat4 uProjectionInverse;
uniform sampler2D uStars;
uniform float uTime;
uniform float uGravity;
uniform float uSpin;
uniform float uTemperature;
uniform bool uLensing;
uniform int uSteps;

const float PI = 3.14159265359;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}

vec3 diskEmission(vec3 p, vec3 direction, float rs) {
  float radius = length(p.xz) / rs;
  float inner = 2.85 - uSpin * 0.55;
  float outer = 9.5;
  float envelope = smoothstep(inner, inner + 0.55, radius)
                 * (1.0 - smoothstep(6.5, outer, radius));
  if (envelope < 0.001) return vec3(0.0);
  float angle = atan(p.z, p.x);
  float orbit = angle - uTime * (0.25 + uSpin * 0.22) / pow(radius / 3.0, 1.5);
  // Cartesian angular coordinates keep turbulent noise continuous at the azimuth seam.
  vec2 swirl = vec2(cos(orbit), sin(orbit)) * radius;
  float turbulence = noise(swirl * 3.0) * 0.5
                   + noise(swirl * 7.0 + uTime * 0.08) * 0.3
                   + noise(swirl * 16.0) * 0.2;
  float bands = sin(radius * 28.0 + turbulence * 9.0 + sin(orbit * 8.0 + radius * 3.0) * 0.8);
  float fineBands = 0.82 + 0.18 * sin(radius * 75.0 + turbulence * 12.0);
  float texture = (0.38 + turbulence * 0.8 + bands * 0.14) * fineBands;
  float heat = pow(3.0 / max(radius, 3.0), 1.6);
  float temperature = smoothstep(4000.0, 15000.0, uTemperature);
  vec3 edge = mix(vec3(1.0, 0.19, 0.035), vec3(0.30, 0.55, 1.0), temperature * temperature);
  vec3 core = mix(vec3(1.0, 0.57, 0.23), vec3(0.78, 0.88, 1.0), temperature);
  vec3 color = mix(edge, core, heat);
  vec3 tangent = normalize(vec3(-p.z, 0.0, p.x));
  float beaming = pow(clamp(1.0 + dot(direction, tangent) * 0.36 * uSpin, 0.5, 1.5), 3.0);
  return color * envelope * texture * (0.45 + heat * 2.2) * beaming;
}

vec3 sky(vec3 direction) {
  vec2 uv = vec2(atan(direction.z, direction.x) / (2.0 * PI) + 0.5,
                 acos(clamp(direction.y, -1.0, 1.0)) / PI);
  return texture2D(uStars, uv).rgb * 1.15;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 view = uProjectionInverse * vec4(ndc, 1.0, 1.0);
  vec3 direction = normalize(mat3(uCameraWorld) * (view.xyz / view.w));
  vec3 position = uCameraPosition;
  vec3 velocity = direction;
  float rs = uGravity;
  float angularMomentum2 = dot(cross(position, direction), cross(position, direction));
  vec3 light = vec3(0.0);
  float transmittance = 1.0;
  bool captured = false;
  float previousRadius = length(position);

  for (int i = 0; i < 144; i++) {
    if (i >= uSteps) break;
    float radius = length(position);
    if (radius < rs * 1.015) {
      captured = true;
      break;
    }
    if (radius > 48.0 * max(rs, 1.0) && radius > previousRadius) break;
    previousRadius = radius;
    float stepSize = max(0.035 * rs, radius * 0.105);
    vec3 oldPosition = position;
    if (uLensing) {
      // Schwarzschild-inspired ray bending. Adaptive steps concentrate work near the horizon.
      vec3 bend = -1.5 * rs * angularMomentum2 * position / pow(radius, 5.0);
      position += velocity * stepSize + bend * (0.5 * stepSize * stepSize);
      float nextRadius = max(length(position), rs * 0.5);
      vec3 nextBend = -1.5 * rs * angularMomentum2 * position / pow(nextRadius, 5.0);
      velocity += (bend + nextBend) * (0.5 * stepSize);
      vec3 frameDrag = vec3(-position.z, 0.0, position.x);
      velocity += frameDrag * uSpin * 0.012 * rs * rs / pow(radius, 3.0) * stepSize;
    } else {
      position += velocity * stepSize;
    }

    // Integrate the thin disk at exact plane crossings, including secondary lensed images.
    if (oldPosition.y * position.y < 0.0) {
      float fraction = oldPosition.y / (oldPosition.y - position.y);
      vec3 crossing = mix(oldPosition, position, fraction);
      vec3 emission = diskEmission(crossing, normalize(velocity), rs);
      float intensity = max(emission.r, max(emission.g, emission.b));
      light += emission * transmittance;
      transmittance *= 1.0 - min(0.82, intensity * 0.17);
    }

    // A finite-height atmosphere keeps the disk visible when observed edge-on.
    float radial = length(position.xz) / rs;
    if (abs(position.y) < rs * 0.22 && radial > 2.3 && radial < 10.0) {
      float density = exp(-abs(position.y) / (rs * 0.055));
      light += diskEmission(position, normalize(velocity), rs)
             * density * stepSize / rs * 0.33 * transmittance;
    }
  }

  if (!captured) light += sky(normalize(velocity)) * transmittance;
  // The narrow photon-ring glow supplements the finite-step ray integration.
  if (uLensing) {
    float impact = sqrt(angularMomentum2);
    float critical = 2.598 * rs;
    float ring = exp(-pow((impact - critical) / (0.045 * rs), 2.0));
    light += vec3(1.0, 0.50, 0.19) * ring * 0.65;
  }
  float vignette = 1.0 - 0.26 * pow(length(ndc * vec2(0.72, 0.85)), 1.7);
  light *= max(0.45, vignette);
  float grain = (hash(vUv * uResolution) - 0.5) / 700.0;
  gl_FragColor = vec4(max(light + grain, 0.0), 1.0);
}
