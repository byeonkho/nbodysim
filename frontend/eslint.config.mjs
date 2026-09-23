import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettier,
  {
    ignores: [
      ".next/**",
      "e2e/.artifacts/**",
      "test-results/**",
      "node_modules/**",
      "next-env.d.ts",
      "src/app/generated/**",
    ],
  },
];

export default config;
