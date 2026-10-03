// Génère le bloc YAML des capteurs HA (un par appareil nommé). Fonction pure, testée.

export type NamedDevice = { cluster_id: number; label: string };

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "") || "appareil";

/**
 * L'identifiant unique et la valeur lue reposent sur cluster_id, jamais sur le nom :
 * renommer un appareil dans /appareils ne crée pas de nouvelle entité et garde l'historique.
 */
export function haRestYaml(devices: NamedDevice[]): string {
  const sensors = devices
    .map(
      (d) => `      - name: "NILM ${d.label.replace(/"/g, "'")}"
        unique_id: fhe_nilm_cluster_${d.cluster_id}
        # ${slug(d.label)} (appareil n°${d.cluster_id})
        value_template: "{{ value_json.by_id['${d.cluster_id}'] }}"
        unit_of_measurement: kWh
        device_class: energy
        state_class: total_increasing`,
    )
    .join("\n");
  return `rest:
  - resource: !secret nilm_devices_url
    scan_interval: 900
    timeout: 60
    headers:
      Authorization: !secret nilm_admin_bearer
    sensor:
${sensors || "      [] # aucun appareil nommé pour l'instant"}
`;
}
