"""Car wash format classification with explicit provenance.

61% of OSM car washes in Utah carry no format tag, so format is a layered
inference. Every record records HOW it was classified so the UI can show
"unknown" honestly instead of inventing a category.

Confidence: observed > brand > name > category > unknown
"""
import re

# Formats use the taxonomy the industry actually uses (ICA: conveyor / in-bay / self-serve)
EXPRESS = "express_tunnel"      # conveyor, the format that runs on memberships
IBA = "in_bay_automatic"        # rollover, usually a fuel-station add-on
SELF = "self_serve"             # wand bays
HAND = "hand_detail"            # hand wash / detailing
FLEX = "flex_full_serve"   # tunnel PLUS interior services
TRUCK = "truck_wash"
UNKNOWN = "unknown"

LABEL = {EXPRESS: "Express tunnel", FLEX: "Flex / full-serve tunnel",
         IBA: "In-bay automatic", SELF: "Self-serve bays",
         HAND: "Hand wash / detail", TRUCK: "Truck wash", UNKNOWN: "Unknown"}

# Utah brands, formats verified against each operator's own website
# (see docs/METHODOLOGY.md for the per-brand evidence table).
# Mixed-format operators are coded to their DOMINANT Utah format; the residual
# error is noted in the methodology rather than hidden.
BRAND_FORMAT = {
    # verified express tunnel (conveyor, free vacuums, unlimited memberships)
    "wiggy wash": EXPRESS, "wiggy": EXPRESS,
    "dino dash": EXPRESS, "charlie's car wash": EXPRESS, "charlies car wash": EXPRESS,
    "velocity car wash": EXPRESS, "velocity wash": EXPRESS,
    "cliff's car wash": EXPRESS, "cliffs car wash": EXPRESS,
    # verified flex / full-serve (tunnel + interior services)
    "fabulous freddy": FLEX, "fab fred": FLEX,
    "wash factory": FLEX, "supersonic car wash": FLEX, "super sonic car wash": FLEX,
    # verified self-serve / in-bay, explicitly NOT tunnels
    "thunder car and pet": SELF, "thunder wash": SELF,
    "hidden cove": IBA, "just wash it": SELF, "curt's car wash": SELF,
    "curts car wash": SELF, "vip car wash": SELF, "vip carwash": SELF,
    "quick quack": EXPRESS, "mister car wash": EXPRESS, "tommy's express": EXPRESS,
    "tommys express": EXPRESS, "rocket carwash": EXPRESS, "rocket car wash": EXPRESS,
    "take 5": EXPRESS, "tagg-n-go": EXPRESS, "tagg n go": EXPRESS, "taggngo": EXPRESS,
    "shiny shell": EXPRESS, "whistle express": EXPRESS, "zips car wash": EXPRESS,
    "super tunnel": EXPRESS, "splash": EXPRESS, "jax car wash": EXPRESS,
    "blue beacon": TRUCK,
    # fuel brands: the wash is an in-bay automatic attached to the c-store
    "chevron": IBA, "speedway": IBA, "holiday oil": IBA, "holiday": IBA,
    "maverik": IBA, "sinclair": IBA, "flying j": IBA, "pilot": IBA,
    "jacksons food stores": IBA, "phillips 66": IBA, "texaco": IBA, "conoco": IBA,
}

NAME_RULES = [
    (TRUCK,   r"\btruck\s*wash|semi\s*wash|blue\s*beacon\b"),
    (SELF,    r"\bself[\s-]*serv|coin[\s-]*op|wand\b|\bu[\s-]*wash|do[\s-]*it[\s-]*yourself"),
    (HAND,    r"\bhand\s*wash|detail|auto\s*spa|hand\s*car\s*wash\b"),
    (EXPRESS, r"\bexpress\b|\btunnel\b|\bunlimited\b|\bdrive[\s-]*thru\b"),
    (IBA,     r"\btouch[\s-]*less|touchless|automatic|in[\s-]*bay|rollover\b"),
]

GOOGLE_CATEGORY = {
    "self service car wash": SELF, "car detailing service": HAND,
    "auto detailing service": HAND, "truck wash": TRUCK,
}


def _brand_hit(text):
    t = (text or "").lower()
    for brand, fmt in BRAND_FORMAT.items():
        if brand in t:
            return brand, fmt
    return None, None


def classify(name=None, tags=None, google_category=None, brand=None, operator=None):
    """Return (format, confidence 0-1, source, evidence).

    Order matters: an observed OSM tag always beats an inference from the name.
    """
    tags = tags or {}

    # 1. Observed OSM tags. Note the undocumented values 'only' and 'partially'
    #    that appear in real Utah data but not in the OSM wiki.
    auto = (tags.get("automated") or "").lower()
    self_s = (tags.get("self_service") or "").lower()
    if self_s == "only" or (self_s == "yes" and auto == "no"):
        return SELF, 0.95, "osm_tag", f"self_service={self_s}, automated={auto or 'unset'}"
    if auto == "yes" and self_s == "no":
        fmt = EXPRESS if re.search(NAME_RULES[3][1], (name or "").lower()) else IBA
        return fmt, 0.75, "osm_tag", f"automated=yes, self_service=no"
    if auto == "yes" and self_s == "yes":
        return SELF, 0.6, "osm_tag", "automated=yes and self_service=yes (mixed site)"
    if auto == "partially":
        return IBA, 0.5, "osm_tag", "automated=partially"

    # 2. Brand lookup
    for candidate in (brand, operator, name):
        b, fmt = _brand_hit(candidate)
        if fmt:
            return fmt, 0.85, "brand", f"brand match: {b}"

    # 3. Google category
    if google_category:
        gc = google_category.strip().lower()
        if gc in GOOGLE_CATEGORY:
            return GOOGLE_CATEGORY[gc], 0.7, "category", f"google category: {gc}"

    # 4. Name regex
    low = (name or "").lower()
    for fmt, rx in NAME_RULES:
        if re.search(rx, low):
            return fmt, 0.5, "name", f"name pattern: /{rx[:28]}/"

    # 5. Honest unknown
    return UNKNOWN, 0.0, "none", "no format signal available"
