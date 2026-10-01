import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bilan énergie",
    short_name: "Énergie",
    description: "Production solaire et consommation de la maison, semaine par semaine.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f2ee",
    theme_color: "#f3f2ee",
    lang: "fr",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
