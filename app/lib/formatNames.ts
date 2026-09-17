/**
 * Display names for car wash types. The map key, the filters, the wash panel
 * and the map hover popup all read this one list, so a type is never called
 * two different things on the same screen.
 */
export const FORMAT_NAMES: [string, string][] = [
  ["express_tunnel", "Express tunnel"],
  ["flex_full_serve", "Flex / full-serve"],
  ["in_bay_automatic", "In-bay automatic"],
  ["self_serve", "Self-serve"],
  ["truck_wash", "Truck wash"],
  ["unknown", "Format unknown"],
  ["hand_detail", "Hand wash / detail"],
];

export const FORMAT_NAME: Record<string, string> = Object.fromEntries(FORMAT_NAMES);
