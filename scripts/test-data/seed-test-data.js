#!/usr/bin/env node
// Physics 215 — Test Response + Score Generator
// Usage: node scripts/test-data/seed-test-data.js
//
// Prereqs:
//   1. Run migration 003 + 004 in Supabase SQL editor
//   2. Upload phys215-test-roster.csv via admin panel
//   3. Provision student accounts via admin Roster tab
//
// This script inserts fake responses + unfinalized scores for phys-215 students.
// By default seeds preflight-1, preflight-2, and preflight-3.
//
// Pass assignment IDs as arguments to seed only those:
//   node scripts/test-data/seed-test-data.js preflight-3
//
// Reads config from: ~/.claude/skills/preflight-analyze/config.json
//   Required keys: supabase_url, supabase_service_key

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Load config ──────────────────────────────────────────────
const configPath = path.join(
  process.env.HOME || process.env.USERPROFILE,
  '.claude', 'skills', 'preflight-analyze', 'config.json'
);

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.error('Could not read config.json:', e.message);
  console.error('Expected path:', configPath);
  process.exit(1);
}

const BASE_URL    = config.supabase_url;
const SERVICE_KEY = config.supabase_service_key;
const COURSE_ID   = 'phys-215';
const MISS_RATE   = 0.10; // ~10% of students per section don't submit

if (!BASE_URL || !SERVICE_KEY) {
  console.error('config.json must contain supabase_url and supabase_service_key');
  process.exit(1);
}

// ── Supabase REST helpers ─────────────────────────────────────
const HEADERS = {
  'Content-Type':  'application/json',
  'apikey':        SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
};

async function dbGet(table, params = '') {
  const url = `${BASE_URL}/rest/v1/${table}?${params}`;
  const resp = await fetch(url, { headers: { ...HEADERS, Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`GET /${table} → ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function dbUpsert(table, rows, onConflict = null) {
  if (!rows.length) return;
  const url  = `${BASE_URL}/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`;
  const resp = await fetch(url, {
    method:  'POST',
    headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body:    JSON.stringify(rows),
  });
  if (!resp.ok) throw new Error(`UPSERT /${table} → ${resp.status}: ${await resp.text()}`);
}

// ── Pick helper ───────────────────────────────────────────────
// Uses a multiplicative hash so consecutive student IDs (sequential integers)
// get well-distributed selections rather than cycling through the array in order.
// 17, 13, 19 are coprime to any pool size ≤ 200, guaranteeing full coverage.
function pick(arr, studentId, assignmentIdx = 0, multiplier = 17) {
  const hash = (studentId * multiplier + assignmentIdx * 1000003) % arr.length;
  return arr[((hash % arr.length) + arr.length) % arr.length];
}

// ── Reading time pool (Q1) ────────────────────────────────────
const READING_TIMES = [
  '15 minutes.',
  'About 20 minutes.',
  '25 minutes.',
  'About 30 minutes.',
  '30 minutes.',
  '35 minutes.',
  'Around 40 minutes.',
  'About 45 minutes.',
  '45 minutes.',
  'Close to an hour.',
  '50 minutes.',
  'About 55 minutes.',
  '1 hour.',
  'About an hour.',
  'An hour and 15 minutes.',
  'An hour and a half.',
  '2 hours.',
  'Around 25 minutes.',
  'Nearly an hour.',
  'I skimmed it quickly, maybe 20 minutes.',
  'Roughly 45 minutes.',
  'About 35 minutes — I had to re-read a few sections.',
  'Maybe 30 minutes, but I plan to review it again before class.',
  'An hour, including re-reading the sections I found confusing.',
  'About 40 minutes.',
];

// ── Preflight-1 pools ─────────────────────────────────────────
// Topic: electrostatics — Coulomb's law, conductors/insulators, charge induction

const PF1_Q2_POOL = [
  "Most interesting: the idea that charged objects exert forces across empty space without touching — action at a distance feels strange even after reading the explanation. Confusing: how ε₀ (permittivity of free space) is defined and what it physically represents beyond being a proportionality constant in Coulomb's law.",
  "I found charging by induction the most fascinating part — you can permanently charge a conductor without ever touching it with the charged object. Confusing: why does the ground connection matter? I understand it provides a path for electrons to leave, but the direction of electron flow wasn't clear to me.",
  "The similarity between Coulomb's law and Newton's law of gravitation was interesting — both go as 1/r² and involve a proportionality constant. What confused me was the direction of the force for different charge sign combinations; I kept having to stop and think about which way the force vector points.",
  "Most confusing was understanding why conductors have free electrons at all. I get that outer electrons in metals are loosely bound, but I'm not sure why they move freely through the entire lattice rather than staying near their original atoms.",
  "Interesting: that the net electric field inside a perfect conductor at electrostatic equilibrium is exactly zero — not just small. It seems remarkable that the electrons always find exactly the right arrangement to cancel the external field internally.",
  "I found the concept of electric field most interesting — the idea that a charge modifies the surrounding space even before any other charge is present to feel a force. What confused me was how to compute the net field direction at a point when multiple source charges are present.",
  "Most confusing: the difference between polar and nonpolar molecules and how it affects their response to an external electric field. Interesting: that everyday static cling is actually a result of charge polarization and not net charge transfer.",
  "Interesting: Faraday cages block external electric fields inside — I didn't realize that was why electronics in metal enclosures are shielded from static discharge. Confusing: why charge distributes on the outside surface of a conductor and not uniformly through the volume.",
  "I found the inverse-square law fascinating — doubling the distance reduces the force by a factor of four. Confusing: whether this law holds all the way down to zero separation, or whether something breaks down at atomic distances.",
  "Most interesting: that charge is quantized — all charges are integer multiples of the electron charge. Confusing: how Millikan's oil-drop experiment actually measured this if each drop has a different, unknown number of electrons on it.",
  "The triboelectric effect was interesting — some materials naturally give up electrons when rubbed against others, which is why rubbing a balloon on your hair causes static. Confusing: what determines which material gains vs. loses electrons in a pair.",
  "I found it interesting that a charged balloon sticks to a neutral wall even though the wall has zero net charge. Confusing: I still don't have a clear picture of why induced polarization produces a net attractive force when neither sign dominates the wall overall.",
  "Most confusing: drawing electric field lines for two equal and opposite charges — I can copy one from the book but I couldn't predict what it looks like from scratch. Interesting: that field lines give both direction and relative magnitude in a single picture.",
  "The idea that charge is conserved — rubbing doesn't create it, only transfers it — was interesting and reassuring. What confused me was how to track where the electrons actually go when a more complex object is charged by contact.",
  "I found the superposition principle for electric fields interesting — you just add individual field vectors. What confused me was why this principle holds so cleanly. Is it an exact law or an approximation that breaks down somewhere?",
  "Most interesting: that non-contact induction leaves a conductor permanently charged after the grounding wire is removed. What confused me was the role of grounding itself — why the Earth acts as an infinite reservoir of charge.",
  "Interesting: that polarization occurs differently in conductors (electrons physically move) vs. insulators (molecules distort slightly). Confusing: for insulators, how much does each molecule actually stretch or rotate? It seems like a tiny effect.",
  "The idea that the electric field acts as a 'messenger' carrying force information between charges was interesting. What confused me was how quickly the field adjusts when one charge moves — does the effect propagate at the speed of light?",
  "I found Coulomb's original torsion-balance experiment interesting — measuring forces between charged spheres with a hanging fiber must have required incredible care. Confusing: how you deal with the formula when the charges have opposite signs and you need to determine the direction.",
  "Most confusing: why the electric field just inside a conductor is zero but the field just outside the surface is nonzero. Interesting: that the field immediately outside a conductor is always perpendicular to the surface.",
  "Interesting: the analogy between electric field lines and streamlines in a fluid flow — both are continuous, don't cross, and show direction. Confusing: how this analogy breaks down for configurations where there are no simple symmetries.",
  "I found it surprising that a conductor in an external field develops surface charges that precisely cancel the applied field in its interior. Confusing: how quickly this happens — is there any measurable delay, or is it essentially instantaneous?",
  "Most interesting: the concept of a test charge — a vanishingly small charge used to probe the field without disturbing it. Confusing: since all real charges are finite, how do experimenters actually measure electric fields in practice?",
  "The distinction between conductors and insulators was more nuanced than I expected. Interesting: that semiconductors can be tuned between the two extremes by adding impurities. Confusing: what determines at the microscopic level whether a material falls into each category.",
  "I found Coulomb's law most interesting for the sheer scale of the forces involved — two 1-coulomb charges 1 meter apart would feel a force of about 9 × 10⁹ N. Confusing: why we don't experience such enormous forces in everyday life if charge is everywhere.",
];

const PF1_Q3_FULL = [
  "They attract. The charged insulator's electric field penetrates the conductor and drives free electrons to redistribute. If the insulator is positive, electrons accumulate on the near face of the metal, leaving the far face positive. The near face (negative) is closer to the insulator than the far face (positive), so the attractive Coulomb force between the near face and the insulator exceeds the repulsive force between the far face and the insulator. Net result: attraction, even though the metal has zero net charge.",
  "Attraction. The insulator sets up an external field, and the metal's free electrons rearrange to cancel that field inside the conductor. This creates a surface charge distribution: opposite sign on the face nearest the insulator, same sign on the far face. The attractive force on the near, opposite face outweighs the repulsive force on the far, like-sign face because Coulomb's force depends on 1/r² and the near face is closer.",
  "They attract. The metal has free electrons that respond to the external field by accumulating on one side — opposite sign faces the insulator, same sign is pushed to the far side. Because the Coulomb force between the insulator and the nearer (opposite) surface is stronger than the repulsion from the farther (same-sign) surface (1/r² dependence), the net force pulls the metal toward the insulator.",
  "Attraction. When the charged insulator is placed nearby, it induces a charge redistribution in the conductor — this is electrostatic induction. The face of the metal closest to the insulator acquires charge opposite to the insulator; the far face acquires equal and opposite charge. The asymmetry in distance (near face closer than far face) means the attractive force exceeds the repulsive force, giving a net attraction.",
  "They attract due to electrostatic induction. The insulator's charge causes free electrons in the metal to accumulate on the side nearest the insulator. That near surface then has charge opposite to the insulator, and the far surface has charge of the same sign. Because force drops off with distance squared, the closer opposite-charge face produces a stronger attraction than the farther same-sign face produces repulsion.",
  "They attract. Electrostatic induction causes the metal's free charges to redistribute: opposite charge concentrates on the face nearest the insulator; like charge builds up on the far face. The Coulomb attraction between the near face and the insulator is larger in magnitude than the repulsion between the far face and the insulator because the near face is at a shorter distance.",
  "The objects attract. The charged insulator induces a dipole-like charge distribution on the conductor. The side facing the insulator acquires opposite polarity; the other side acquires like polarity. Coulomb's force falls as 1/r², so the attractive interaction with the nearer opposite-polarity face dominates the repulsive interaction with the farther same-polarity face. Net force: attractive.",
  "Attraction. The key mechanism is induction: free electrons in the metal shift so that one face has charge opposite to the insulator (attractive) and the other has charge of the same sign (repulsive). The attractive force wins because that face is closer — Coulomb's law penalizes distance more heavily than the charge magnitudes differ.",
  "They attract. A charged insulator induces a charge separation in the neutral conductor: electrons accumulate on the near side (if insulator is positive) or deplete from it (if negative). Either way the near face has opposite charge to the insulator. Since the attractive force on the near face (shorter distance) is larger than the repulsive force on the far face (greater distance), the net force is attractive.",
  "The two objects attract. Bringing a charged insulator near a neutral metal causes electrostatic induction: free electrons redistribute so that opposite charge appears on the near surface and like charge on the far surface. Even though the metal has zero net charge, the geometric asymmetry — opposite charge is closer to the insulator than the like charge — produces a net attractive force.",
];

const PF1_Q3_WARN = [
  "They attract. The charge on the insulator sort of pulls the electrons in the metal toward it, so the side of the metal closer to the insulator becomes oppositely charged. Since unlike charges attract, they pull toward each other.",
  "They attract because the metal's free electrons can move. The charged insulator causes charge rearrangement in the metal so the side facing the insulator ends up with opposite charge, which creates attraction.",
  "Attraction. The charged insulator causes electron movement in the metal so that one face becomes oppositely charged. Opposite charges attract, so the net effect is that the two objects pull together.",
  "They attract. Even though the metal has no net charge, the charges inside can shift. The charged insulator makes the charges redistribute so one face is oppositely charged, and that creates a net attractive force.",
  "I believe they attract. The electric field from the insulator causes some kind of charge separation in the metal so one face is positive and one is negative. The face with opposite charge to the insulator is attracted toward it.",
  "The objects attract. The charged insulator creates an electric field that causes charges in the metal to rearrange. The face of the metal closest to the insulator ends up with opposite charge, which creates attraction.",
  "They attract each other. The charged insulator induces charge movement in the metal so that there's an opposite charge on the surface closest to it. That opposite charge is attracted to the insulator.",
  "They attract. When you bring a charged insulator near a metal, the metal's electrons respond and accumulate on the near side (for a positive insulator). So the near side is negative and the insulator is positive — opposite charges attract.",
  "I think they attract. The insulator has charge that affects the metal even from a distance. Charges in the metal shift to create opposite polarity on the near face, leading to attraction.",
  "They attract each other. The charged insulator induces a slight charge separation in the metal, making one side negative and the other positive. The side with opposite charge faces the insulator, so there's an attractive force.",
];

const PF1_Q3_ZERO = [
  "They repel. The charged insulator pushes the same type of charges to the surface of the metal, so the near face of the metal has the same sign charge, and like charges repel.",
  "Nothing happens. The metal is electrically neutral, and Coulomb's law says the force between a charged object and a neutral one is zero — neutral objects don't have net charge to interact with.",
  "They repel. A charged insulator near a conductor would induce charges of the same sign on the near surface, causing repulsion between the two objects.",
  "There's no force. The metal has zero net charge, so it doesn't interact with the charged insulator. Electrostatic forces only act between objects that are charged.",
  "They repel because the insulator is already charged and the conductor would develop the same charge on its near surface, leading to a repulsive force between them.",
  "",
  "They attract if the charges are opposite and repel if they are the same. It depends on what charge the metal has, but if it's neutral, there's no interaction.",
  "Nothing. The conductor shields itself from the charged insulator, so there's no net force on the conductor from an external charge.",
  "They repel. The field from the insulator pushes electrons away to the far side, making the near face positive if the insulator is also positive — same charge type on both near surfaces means repulsion.",
  "They attract or repel depending on the type of charge on the insulator. If the insulator is positive it attracts negative charges and repels positive ones, so the forces cancel and there's no net effect.",
];

// ── Preflight-2 pools ─────────────────────────────────────────
// Topic: polarization of light — Malus's Law, polarizers, birefringence

const PF2_Q2_POOL = [
  "Most interesting: Malus's Law — the transmitted intensity drops as cos² of the angle between the polarizers. Confusing: I understand the formula gives cos² but I'm not sure where the squared comes from physically rather than just algebraically.",
  "Interesting: two crossed polarizers block essentially all light, but inserting a third polarizer at 45° between them lets some light through again. It seems counterintuitive that adding another blocking filter increases the transmission.",
  "I found it fascinating that the sky is polarized due to Rayleigh scattering. Confusing: I understand scattered light is polarized perpendicular to the scattering plane, but I couldn't follow why scattering selects that particular direction.",
  "Most confusing: how LCDs work at the pixel level. Apparently each pixel uses a liquid crystal as a voltage-controlled polarization rotator. Interesting: I had no idea every screen pixel contains a miniature optics experiment.",
  "Interesting: Brewster's angle — at a specific incidence angle the reflected light is completely linearly polarized. Confusing: I don't have an intuitive picture for why the degree of polarization of the reflected light depends on the incidence angle.",
  "I found it interesting that polarized sunglasses cut glare specifically from horizontal surfaces because reflected light is preferentially horizontally polarized. Confusing: the physical reason for that horizontal polarization of reflected sunlight.",
  "Most interesting: circular polarization — the electric field vector rotates in a helix as the wave propagates. Confusing: how a quarter-wave plate converts linearly polarized light to circularly polarized light — the component decomposition makes sense but I lack a physical picture.",
  "The use of polarization in 3D movie technology was the most interesting application. Confusing: how two polarizations can carry two different images to two eyes without one blocking the other entirely.",
  "I found birefringent materials fascinating — different polarization components travel at different speeds, creating a phase difference. Confusing: how the 'extraordinary ray' direction is defined and why it doesn't follow the usual Snell's law.",
  "Most confusing: the relationship between polarization and the transverse nature of EM waves. I understand light is a transverse wave, but I couldn't fully visualize what 'transverse' means for an electric field oscillating as the wave propagates through empty space.",
  "Interesting: optical activity in chiral molecules rotates the plane of polarization. Confusing: I can't picture how a molecule's handedness could interact differently with left vs. right circularly polarized light.",
  "I found the historical context interesting — Malus discovered polarization by reflection in 1808 using a calcite crystal in sunlight. Confusing: how they measured polarization precisely without electronic instruments.",
  "Most interesting: realizing that Malus's Law is essentially just a dot product squared — the transmitted intensity is proportional to the square of the projection of the polarization direction onto the transmission axis.",
  "Interesting: that unpolarized light can be modeled as a rapid random superposition of all linear polarization directions. Confusing: is this really a continuum, or are there discrete polarization states? What does 'random' mean for a deterministic wave?",
  "Most confusing: distinguishing polarization by absorption (dichroic polarizer), by reflection (Brewster angle), and by scattering. All three select a polarization direction but the mechanisms are completely different.",
  "I found it interesting that a polaroid filter is just a sheet of aligned polymer chains that selectively absorb one polarization direction. Confusing: why absorption is selective for a polarization direction — what is it about the polymer alignment that does this?",
  "Most interesting: that stressed transparent plastics show colorful birefringence patterns under crossed polarizers, which is used to visualize internal stress distributions in engineering models. Confusing: how mechanical stress changes the optical properties.",
  "Interesting: that a half-wave plate rotates the polarization direction by twice the plate angle, while a quarter-wave plate converts linear to circular polarization. Confusing: why the factor is exactly π (half-wave) vs. π/2 (quarter-wave) and how plate thickness controls the phase shift.",
  "Most confusing: the difference between dichroism (selective absorption by polarization direction) and birefringence (different refractive indices for different polarizations). I kept mixing them up — both involve polarization-dependent material response but in different ways.",
  "Interesting: that polarization is used in fiber-optic communications — some systems carry separate data channels in different polarization states. Confusing: how the polarization state stays intact over kilometers of fiber without the two polarizations mixing.",
  "I found Malus's Law elegant because it connects a geometric relationship (the angle between two axes in space) to a physically measurable quantity (light intensity). Confusing: what physically happens to the blocked fraction of light — does it get reflected, absorbed, or scattered?",
  "Most interesting: the idea that when a polarizer 'blocks' some light, it's not absorbing it — it's actually the electric field component perpendicular to the transmission axis that is prevented from propagating. Confusing: what exactly happens to that perpendicular component.",
  "I found it interesting that you can fully characterize the polarization state of a beam by making just three intensity measurements with a polarizer at different orientations. Confusing: why three measurements are sufficient — it seems like you'd need more.",
  "Most confusing: how LCD pixel color is controlled using polarization. Each pixel seems to need both a polarizer and a color filter and a backlight. Interesting: seeing how several optics concepts I've studied separately all come together in a commercial product.",
  "Interesting: that you can determine whether light is polarized just by rotating a single polaroid filter — polarized light produces a bright-dark oscillation while unpolarized light stays constant. Confusing: what distinguishes circularly polarized light from unpolarized light in this test.",
];

const PF2_Q3_FULL = [
  "The two polarizers are oriented at different angles. The first converts unpolarized light to linearly polarized light with intensity I₀. By Malus's Law, the second polarizer (at angle θ to the first) transmits only the fraction cos²θ of that intensity: I = I₀cos²θ. If θ is large (close to 90°), cos²θ is nearly zero, so almost no light gets through and the source looks very dim.",
  "After the first polarizer the light is linearly polarized. The second polarizer has its transmission axis at angle θ relative to the first. The component of the polarized electric field along the second axis has magnitude E₀cosθ. Since intensity is proportional to E², the transmitted intensity is I = I₀cos²θ — Malus's Law. A large angle between the two axes means cos²θ is small, resulting in a dim source.",
  "The first polarizer selects one polarization direction, halving the intensity of the original unpolarized light and producing linearly polarized light. The second polarizer is oriented at angle θ relative to the first. By Malus's Law, only the fraction cos²θ of the polarized intensity passes through. When θ is near 90°, cos²θ ≈ 0, and the source appears very dim.",
  "Light from the source is unpolarized. The first polarizer restricts the transmitted light to a single plane of vibration (linear polarization). The second polarizer, at angle θ to the first, applies Malus's Law: I = I₀cos²θ. For a large angle θ the transmitted fraction cos²θ is small, making the source appear dim. The dimness depends entirely on the relative orientation of the two polarizers.",
  "The source appears dim because the two polarizers are nearly perpendicular to each other. After the first polarizer the light is linearly polarized along a fixed axis. The second polarizer transmits only the component of that field along its own axis. By Malus's Law, I = I₀cos²θ. Near θ = 90°, the cosine squared term approaches zero and essentially no light passes through.",
  "The two polarizers have their transmission axes at a large angle θ relative to each other. After the first, the light is linearly polarized. The second applies Malus's Law: I = I₀cos²θ. Since θ is large, cos²θ is close to zero, so only a small fraction of the already-polarized light makes it through. This is why the source looks dim — the angle between the polarizers governs transmission, not wavelength filtering or absorption.",
  "After the first polarizer the light is linearly polarized with intensity I₀. The second polarizer is rotated by angle θ and passes intensity I₀cos²θ (Malus's Law). When θ is nearly 90° the source goes almost dark. This happens because the second polarizer blocks the component of the electric field not aligned with its transmission axis, and when θ = 90° the two axes are perpendicular — there is zero projection.",
  "The brightness is determined by the relative angle of the two polarizers. The first creates linearly polarized light; the second transmits only the fraction cos²θ of that polarized intensity by Malus's Law. A large θ (close to 90°) gives a very small cos²θ, leaving little light. The key point is that it's the angular relationship between the two transmission axes — not the number of polarizers or the light's color — that controls how much gets through.",
  "Two effects combine here. First, the initial polarizer reduces the intensity to roughly half (it selects one polarization from unpolarized light). Second, the second polarizer is at angle θ to the first and applies Malus's Law: the transmitted intensity is I₀cos²θ. Because the two polarizers are nearly crossed (θ close to 90°), cos²θ ≈ 0 and almost no light reaches the observer. The source appears dim.",
  "The dimness arises from Malus's Law. The first polarizer converts unpolarized light to linearly polarized light. The second polarizer then projects the polarized field onto its own transmission axis; the transmitted intensity is I = I₀cos²θ where θ is the angle between the two polarizers. When the polarizers are nearly perpendicular, cos²θ is near zero — the polarized beam has almost no component along the second polarizer's axis, and very little light passes through.",
];

const PF2_Q3_WARN = [
  "The polarizers are oriented at different angles, so they don't both pass light in the same direction. After the first, light only vibrates in one plane. The second is tilted, so it can only transmit the part aligned with it. If they're nearly perpendicular, almost nothing gets through and the source looks very dim.",
  "The two polarizers are set at a large angle relative to each other. The first one polarizes the light in one direction and the second has a transmission axis that's nearly perpendicular, so most of the polarized light is blocked and the source appears dim.",
  "Because the polarizers are misaligned. The first cuts the light down to one direction of vibration. The second is at a different angle, so it only passes a small portion of that already-filtered light. The further apart their angles, the less light gets through.",
  "The polarizers are at a large angle to each other. The first polarizes the light and the second is rotated so that most of the polarized light can't pass through it. That mismatch in alignment makes the source appear very dim.",
  "The dimness is due to how the two polarizers are oriented relative to each other. Light gets polarized by the first filter, then the second filter is rotated so that most of the polarized light can't pass. The larger the angle between them, the less light comes through.",
  "Both polarizers have to be aligned for maximum light transmission. In this case they're at a large angle, so the polarized light from the first hits the second mostly perpendicular to its transmission axis and most of it gets blocked.",
  "The light must pass through two polarizers that are rotated relative to each other. After the first, the light has one polarization direction. The second is oriented differently and only transmits the fraction that matches its direction — since the angle is large, very little matches.",
  "The two polarizers are at different angles, so they don't transmit the same polarization state. After the first filter, the light is polarized in one direction. The second filter is misaligned, so it passes only a small component and blocks the rest, making the source look dim.",
  "The polarizers are oriented at an angle to each other, causing the light to be very dim. After the first, the light has one polarization. The second is rotated, so it lets through only a small fraction of that polarized light.",
  "The light has to pass through two polarizers that are not aligned with each other. The first restricts the light to one polarization direction and the second is at an angle to that, so it only lets through the part that aligns with it. When the angle is large, very little aligns and the source looks dim.",
];

const PF2_Q3_ZERO = [
  "The two polarizers absorb more light than a single one. Two filters means less total light gets through than with just one, so the source appears dim.",
  "The polarizers block different parts of the light spectrum. Together they filter out more wavelengths, leaving very little visible light to reach your eye.",
  "",
  "The glass in the polarizers absorbs light passing through it. Two polarizers absorb twice as much as one would, so the source appears much dimmer.",
  "Polarizers are dark filters, similar to sunglasses. Adding two together blocks more of the overall light, making the source look dimmer.",
  "The polarizers scatter the light in multiple directions so less of it reaches your eye in a straight line.",
  "The light reflects off the surfaces of both polarizers, reducing the intensity. Two glass surfaces mean double the reflection losses compared to a single polarizer.",
  "One polarizer passes horizontal light and the other passes vertical light, so together they block everything — no light that passes the first can also pass the second.",
  "Each polarizer reduces the light intensity by half regardless of orientation. Two polarizers together reduce it to 25% of the original, which is why the source looks dim.",
  "The first polarizer reduces the brightness because it absorbs half the light, and the second one also absorbs more. Together the absorption is enough to make the source very dim.",
];

// ── Preflight-3 pools ─────────────────────────────────────────
// Topic: vector Coulomb's law, superposition, electric fields

const PF3_Q2_POOL = [
  "Most interesting: the vector form of Coulomb's law — the unit vector r̂ automatically gives the repulsion direction for like charges and attraction for unlike, all in one expression. Confusing: I got confused with the subscript convention for which charge is the source and which is the field point.",
  "I found the superposition principle interesting — each pair of charges behaves as if all others don't exist, then you add the forces as vectors. What confused me was whether this is a fundamental physical law or a mathematical approximation that breaks down at high charge densities.",
  "Most confusing: tracking directions in a multi-charge problem. I understand each individual Coulomb force, but when I tried to add three or four force vectors, I lost track of which way each one pointed. Interesting: that this is exactly the problem vector notation is designed to solve.",
  "Interesting: that Coulomb's law and Newton's law of gravitation have the same mathematical form (both ∝ 1/r²). Confusing: why the electric force is so much stronger than gravity — the ratio for a proton-electron pair is about 10³⁶, which I find hard to make sense of.",
  "Most interesting: the concept of electric potential energy and how it relates to the work done in moving a charge through a field. What confused me was the sign convention — I couldn't immediately tell from the setup whether moving a charge increases or decreases the potential energy.",
  "I found the definition of the electric field (force per unit test charge) interesting — it separates the source field from the response of any charge placed there. Confusing: how you define the field at a point in space where there's currently no charge present.",
  "Most confusing: distinguishing between the force on a charge and the electric field at the same location. I kept writing F = qE and then getting confused about which quantity carries the direction of the Coulomb force. Interesting: for a negative charge, F and E point in opposite directions.",
  "Interesting: that electric field lines can represent both direction and relative magnitude — denser lines indicate stronger field. What confused me was how to sketch field lines for an asymmetric charge distribution without computing it numerically.",
  "Most confusing: why we define Coulomb's constant as k = 1/(4πε₀) rather than just using k directly. The 4π factor seems to come from Gauss's Law, but I'm not sure why. Interesting: that this choice makes Gauss's Law cleaner at the cost of making Coulomb's Law look more complicated.",
  "I found it interesting that Coulomb's law was measured experimentally with a torsion balance — not obvious how you make that measurement precisely enough with such a delicate apparatus. Confusing: over what range of distances the law has been verified.",
  "Most interesting: the electric dipole — two equal and opposite charges separated by a small distance. The field pattern looks very different from a monopole, and I'm curious why. Confusing: the dipole moment vector is defined pointing from negative to positive, which is opposite to the direction of the electric field between the charges.",
  "I found it interesting that even though each Coulomb force only involves two charges, a many-charge system quickly becomes complicated because every pair interacts. Confusing: how physicists handle macroscopic systems with 10²³ charges — clearly pair-by-pair Coulomb calculation is impossible.",
  "Most confusing: the 'continuous charge distribution' version of Coulomb's law that integrates dq over a line, surface, or volume. I can follow the setup but I lose track of what the differential element dq physically represents and how it relates to charge density.",
  "Interesting: that the electric field is defined at every point in space, even far from any charge. Confusing: whether this field is physically real or just a mathematical bookkeeping tool — does it carry energy even in empty space?",
  "I found charge quantization interesting — all charge comes in units of e = 1.6 × 10⁻¹⁹ C. What confused me was whether Coulomb's law gives an exact result for one or two electrons interacting, or whether quantum mechanics changes the calculation.",
  "Most confusing: whether an equilibrium position for the middle charge in a three-charge line configuration is stable or unstable. I can check whether the forces cancel at a point, but figuring out what happens when it's displaced slightly takes more thought than I expected.",
  "I found it interesting that electric field lines start on positive charges and end on negative charges — this is built into the divergence of the field. Confusing: what happens in a region with no charges — do the lines just continue through empty space indefinitely?",
  "Most interesting: that the 1/r² dependence of Coulomb's law is geometrically natural in 3D space — the same factor that makes area grow as r². Confusing: whether there's a deeper physical reason beyond geometry, or whether the 1/r² form is simply what experiment shows.",
  "I found it surprising that a continuous charge distribution can be handled by integration — you just treat each infinitesimal element as a point charge and integrate. Confusing: setting up the integral for off-axis points where symmetry doesn't simplify the transverse components.",
  "Most confusing: computing the electric field at a point on the axis of a uniformly charged ring is manageable with symmetry, but off-axis looks difficult. Interesting: that the symmetry argument that cancels transverse components on-axis is so powerful — a complete solution requires no integration for the direction.",
  "I found the analogy between Coulomb's law and gravity interesting but also noted a key difference: gravity is always attractive while electric forces can be either sign. Confusing: does this asymmetry mean the two forces need completely different physical explanations at a fundamental level?",
  "Most interesting: the idea that adding more charges doesn't change the force between any existing pair — full superposition. Confusing: is this verified experimentally for very strong fields or very high charge densities, or are there regimes where superposition breaks down?",
  "I found the motion of a test charge in a uniform electric field interesting — it's directly analogous to projectile motion in gravity. What confused me was how to set up the equations when the initial velocity is not aligned with the field direction.",
  "Most confusing: why we need both the concept of the field and the concept of force — once you know the field at a point and the charge of a particle, the force is just F = qE. Is the field just a calculational shortcut, or is it more fundamental than the force? Interesting: thinking about this as the beginning of field theory.",
  "I found it interesting that Coulomb's law implies both attraction and shielding in ways gravity does not. A positive charge surrounded by a spherical shell of negative charge feels no external force — gravity has no such shielding. Confusing: what this means for macroscopic objects that have nearly equal numbers of positive and negative charges.",
];

const PF3_Q3_FULL = [
  "I would apply the superposition principle: calculate each force separately, then vector-add. Step 1: Use Coulomb's law to find the force F₁ on the middle charge from the left charge — magnitude k|q_L||q_M|/r_L², direction along the line (repulsive if same sign, attractive if opposite). Step 2: Same procedure for the right charge, giving F₂. Step 3: Define a positive direction along the line (say, rightward) and add the two forces algebraically. You must treat forces as vectors because F₁ and F₂ often point in opposite directions. Adding their magnitudes would overcount; the actual net force comes from their algebraic sum.",
  "Apply the superposition principle: each outer charge exerts a Coulomb force on the middle charge independently. Use F = kq₁q₂/r² for each outer-middle pair, determine the direction (repulsive for same-sign charges, attractive for opposite-sign), then vector-add the two forces along the line. Force must be treated as a vector because if both outer charges have the same sign as the middle charge, F₁ points rightward and F₂ points leftward — they partially cancel. Scalar addition of magnitudes would ignore this cancellation and give the wrong (larger) answer.",
  "Step 1: Compute the Coulomb force on the middle charge from the left charge alone. Magnitude: k|q_L||q_M|/r_L². Direction: away from the left charge if same sign, toward it if opposite. Step 2: Repeat for the right charge. Step 3: Assign algebraic signs based on direction and sum. Vectors are essential: if both outer charges are identical, the left one pushes the middle right while the right one pushes it left — these contributions partially cancel, and the net force is less than either alone. Summing magnitudes would give twice F₁, which is wrong.",
  "Use Coulomb's law for each outer-middle pair (superposition). For the left charge: |F₁| = kq_Lq_M/r_L², directed along the line based on charge signs. For the right charge: |F₂| = kq_Rq_M/r_R², also directed along the line. Then vector-add by choosing a sign convention (right = +) and summing: F_net = ±F₁ ± F₂ with signs from the directions. The reason for vectors: the two forces generally act in opposite directions along the line. Magnitude addition would give an upper bound, not the actual net force, which depends on how much the two contributions reinforce or cancel.",
  "The approach is superposition. Find F₁: the Coulomb force the left charge exerts on the middle, including direction — repulsive if same sign, attractive if opposite. Find F₂: the same from the right charge. Vector-sum F₁ + F₂ along the line, using + and − signs for direction. Why vectors? Because the two forces typically act in opposite directions along the line. For example, if the middle charge is positive and both outer charges are also positive, the left one pushes right (+) and the right one pushes left (−) — the net force is the difference. Adding magnitudes would give the sum instead.",
  "Superposition: compute each force independently, then add as vectors. Coulomb force on the middle from the left charge: F₁ = k|q_L||q_M|/r_L² in the direction pointing away from the left charge (same sign) or toward it (opposite sign). Same for the right charge, giving F₂. Sum along the axis with a sign convention. Vectors are required because force has direction and the two forces may oppose each other. If the middle charge sits between two equal positive charges, F₁ and F₂ exactly cancel and the net force is zero — but magnitudes would add to 2F, not zero.",
  "To find the net force on the middle charge, use superposition: treat each outer charge as if it acts alone. Use Coulomb's law for the left-middle pair (magnitude and direction). Repeat for the right-middle pair. Then combine the two forces using vector addition — pick right as + along the axis, assign each force a sign based on direction, and add. The vector approach is necessary because the forces can point in opposite directions. A common case: same sign all three charges → F₁ points right, F₂ points left → they partially cancel. Adding magnitudes instead would incorrectly give F₁ + F₂.",
  "Apply the superposition principle in three steps. Step 1: Coulomb force from left charge on middle charge — magnitude k|q_L||q_M|/r_L², direction along the line (repulsion or attraction based on signs). Step 2: Coulomb force from right charge on middle — same procedure. Step 3: Vector-add by choosing a coordinate direction and summing with appropriate signs. The force must be treated as a vector because F₁ and F₂ often act in opposite directions along the line. If you just add magnitudes, you would ignore any cancellation and get an answer that is too large whenever the two forces point in opposite directions.",
  "Use Coulomb's law twice, once per outer-middle pair, then vector-sum the results. The magnitude of each force is k|q₁||q₂|/r². The direction is along the line connecting the charges: away from the outer charge (same sign) or toward it (opposite sign). After computing both forces, add them along the axis with a sign convention. Must use vectors because forces are directional quantities. If I place a positive charge between two positive outer charges, the left one pushes it rightward and the right one pushes it leftward — these cancel. Adding magnitudes would give a positive nonzero answer instead of zero.",
  "Superposition gives the procedure: find F₁ (force on middle from left) and F₂ (force on middle from right) using Coulomb's law for each pair, including directions, then add them as vectors along the line. The reason vector addition is necessary: the two forces can have opposite signs along the axis. For symmetric configurations with equal outer charges, the forces are equal and opposite — the net force is zero, while the sum of magnitudes would be twice F₁. Direction-blind magnitude addition systematically overestimates the net force.",
];

const PF3_Q3_WARN = [
  "You'd calculate the Coulomb force from each outer charge on the middle charge separately using F = kq₁q₂/r², then add the two forces together. You have to treat them as vectors because the forces could point in different directions — just adding magnitudes wouldn't tell you which way the net force points or how much cancellation occurs.",
  "Use superposition: find the force each outer charge exerts on the middle charge independently, then combine them. It has to be a vector sum because the two forces can act in opposite directions along the line, and ignoring that would give the wrong net force.",
  "Calculate F from the left charge, calculate F from the right charge, then add them as vectors. You can't just add magnitudes because direction matters — the forces might be pointing toward each other or away, which changes the result significantly.",
  "Find the force from each outer charge separately using Coulomb's law, then add the two forces as vectors. You need vector addition because the forces can act in opposite directions — if they point opposite ways they partially cancel, but adding magnitudes would give a larger, incorrect answer.",
  "Apply Coulomb's law for each outer-middle pair to get a force with direction. Then sum the two forces as vectors. Without treating them as vectors, you'd miss the fact that forces in opposite directions cancel rather than add.",
  "Compute the Coulomb force from each outer charge on the middle charge independently, then do a vector sum. It has to be a vector sum because one force might push the middle charge left while the other pushes it right, and the actual displacement depends on the net vector, not the sum of sizes.",
  "Use Coulomb's law twice to get F₁ and F₂, including their directions along the line. Then add them as vectors. You need vectors because the forces could be in opposite directions — if that's the case, the magnitudes subtract rather than add.",
  "Calculate F₁ (from left charge to middle) and F₂ (from right charge to middle) using Coulomb's law, including directions. Then add them as vectors. Without treating direction, you'd miss cases where the two forces oppose each other and the net result is smaller than either alone.",
  "Find the force from each outer charge on the middle charge separately, then sum as vectors. Must include direction because the two forces can act in opposite directions — the net force depends on how they combine, not just on their individual magnitudes.",
  "Calculate each Coulomb force independently and then sum them as vectors. It must be a vector sum because one force might point right and the other left, and the net effect is determined by the vector sum, not the sum of sizes.",
];

const PF3_Q3_ZERO = [
  "Add up all the Coulomb forces on the middle charge. The net force is the sum of the magnitudes of the two individual forces.",
  "You would calculate the force from each outer charge using F = kq₁q₂/r² and then add them together. The total force is just the sum of all the individual Coulomb forces acting on the middle charge.",
  "",
  "Find F₁ and F₂ using Coulomb's law and then add them to get the total force on the middle charge. Since both outer charges are exerting forces on the middle one, you add them up.",
  "Calculate the force from the left charge and the force from the right charge, then add them. The net force on the middle charge is F₁ + F₂.",
  "Use Coulomb's law to find each force separately, then add the magnitudes together to get the total force on the middle charge.",
  "The net force is found by adding all individual forces on the middle charge. Since there are two other charges, calculate each Coulomb force and sum the results.",
  "Apply Coulomb's law to each pair — left-middle and right-middle — then add the results to find the net force acting on the middle charge.",
  "You would add all the forces acting on the middle charge. Compute the force from the left charge and the force from the right charge, then combine them to get the total.",
  "Simply calculate the magnitude of each Coulomb force using F = kq₁q₂/r², then add the two magnitudes to get the net force on the middle charge.",
];

// ── Quality tier distribution ─────────────────────────────────
// ~65% full credit, ~20% warn, ~15% zero — spread by student_id hash
function getQualityTier(studentId, assignmentIdx) {
  const v = (studentId * 31 + assignmentIdx * 7) % 100;
  if (v < 65) return 'full';
  if (v < 85) return 'warn';
  return 'zero';
}

// ── Answer generation ─────────────────────────────────────────
function generateAnswers(assignmentId, student) {
  const sid  = student.student_id;
  const aIdx = assignmentId === 'preflight-1' ? 0
             : assignmentId === 'preflight-2' ? 1
             : 2;

  const q1 = pick(READING_TIMES, sid, aIdx, 19);

  const q2Pool = assignmentId === 'preflight-1' ? PF1_Q2_POOL
               : assignmentId === 'preflight-2' ? PF2_Q2_POOL
               : PF3_Q2_POOL;
  const q2 = pick(q2Pool, sid, aIdx, 17);

  const tier = getQualityTier(sid, aIdx);
  const q3Pool = assignmentId === 'preflight-1'
    ? (tier === 'full' ? PF1_Q3_FULL : tier === 'warn' ? PF1_Q3_WARN : PF1_Q3_ZERO)
    : assignmentId === 'preflight-2'
    ? (tier === 'full' ? PF2_Q3_FULL : tier === 'warn' ? PF2_Q3_WARN : PF2_Q3_ZERO)
    : (tier === 'full' ? PF3_Q3_FULL : tier === 'warn' ? PF3_Q3_WARN : PF3_Q3_ZERO);
  const q3 = pick(q3Pool, sid, aIdx, 13);

  return { q1, q2, q3 };
}

// ── Score generation ──────────────────────────────────────────
const PF1_FEEDBACK = {
  full: '',
  warn: 'Full credit, but try to be more specific — mention that free electrons redistribute and that the near-face/far-face distance asymmetry is what makes the net force attractive.',
  zeroBlank: 'No answer provided.',
  zeroWrong: 'Incorrect. They attract due to electrostatic induction: free electrons in the conductor redistribute, creating opposite charge on the near face and same-sign charge on the far face. Because Coulomb\'s force falls off as 1/r², the near-face attraction dominates the far-face repulsion.',
};
const PF2_FEEDBACK = {
  full: '',
  warn: "Full credit. For future preflights, try to include Malus's Law (I = I₀cos²θ) and explain that the relative angle between the two polarizers determines how much light gets through.",
  zeroBlank: 'No answer provided.',
  zeroWrong: "Incorrect. The dimness comes from Malus's Law: after the first polarizer the light is linearly polarized. The second polarizer transmits fraction cos²θ of that intensity, where θ is the angle between the two transmission axes. A large angle means cos²θ ≈ 0, hence a dim source.",
};
const PF3_FEEDBACK = {
  full: '',
  warn: 'Full credit. For future preflights, try to include the specific reason vectors are required: if the two outer forces point in opposite directions, they partially cancel — simple magnitude addition ignores this cancellation and gives the wrong (larger) answer.',
  zeroBlank: 'No answer provided.',
  zeroWrong: 'Incorrect. Use the superposition principle: apply Coulomb\'s law to each outer-middle pair independently (including direction), then vector-add the two forces along the line. You cannot add magnitudes because the forces often point in opposite directions and would cancel, not add.',
};

function generateScore(assignmentId, answers, studentId) {
  const aIdx = assignmentId === 'preflight-1' ? 0
             : assignmentId === 'preflight-2' ? 1
             : 2;
  const tier = getQualityTier(studentId, aIdx);

  // q1: no points; any answer = full
  const q1Score = (answers.q1 || '').trim()
    ? { score: 0, max: 0, feedback: '', status: 'full' }
    : { score: 0, max: 0, feedback: 'No answer provided.', status: 'zero' };

  // q2: full if >60 chars, warn if 10-60, zero if blank
  const q2len = (answers.q2 || '').length;
  const q2Score = q2len > 60
    ? { score: 1, max: 1, feedback: '', status: 'full' }
    : q2len >= 10
      ? { score: 1, max: 1, feedback: 'While we gave you credit, please be more thorough in future preflights.', status: 'warn' }
      : { score: 0, max: 1, feedback: 'No substantive answer provided.', status: 'zero' };

  // q3: based on quality tier
  const fb = assignmentId === 'preflight-1' ? PF1_FEEDBACK
           : assignmentId === 'preflight-2' ? PF2_FEEDBACK
           : PF3_FEEDBACK;
  const q3Score = tier === 'full'
    ? { score: 1, max: 1, feedback: fb.full, status: 'full' }
    : tier === 'warn'
      ? { score: 1, max: 1, feedback: fb.warn, status: 'warn' }
      : (answers.q3 || '').trim()
        ? { score: 0, max: 1, feedback: fb.zeroWrong, status: 'zero' }
        : { score: 0, max: 1, feedback: fb.zeroBlank, status: 'zero' };

  const totalScore = q1Score.score + q2Score.score + q3Score.score;
  const maxTotal   = 2;

  return {
    student_id:      studentId,
    assignment_id:   assignmentId,
    question_scores: { q1: q1Score, q2: q2Score, q3: q3Score },
    total_score:     Math.round(totalScore * 100) / 100,
    max_total:       maxTotal,
    is_finalized:    false,
  };
}

// ── Submission timestamp ──────────────────────────────────────
function randomSubmitDate() {
  const base   = new Date('2026-06-04T20:00:00Z').getTime();
  const spread = 48 * 60 * 60 * 1000;
  return new Date(base - Math.random() * spread).toISOString();
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('Fetching phys-215 sections…');
  const sections  = await dbGet('sections', `course_id=eq.${COURSE_ID}&select=id`);
  const sectionIds = sections.map(s => s.id);

  if (!sectionIds.length) {
    console.error('No sections found for phys-215. Upload the roster CSV first.');
    process.exit(1);
  }
  console.log(`Found ${sectionIds.length} section(s): ${sectionIds.join(', ')}`);

  console.log('Fetching students…');
  const students = await dbGet(
    'students',
    `section_id=in.(${sectionIds.join(',')})&select=student_id,name,section_id&order=section_id,student_id`
  );
  console.log(`Found ${students.length} students`);

  if (!students.length) {
    console.error('No students found. Upload the roster CSV first.');
    process.exit(1);
  }

  // Group by section
  const bySect = {};
  for (const s of students) {
    (bySect[s.section_id] = bySect[s.section_id] || []).push(s);
  }

  // responsesOnly: true → insert responses but skip pre-seeded scores
  // (run /preflight-analyze afterward to generate real suggested scores)
  const ALL_ASSIGNMENTS = [
    { id: 'preflight-1', responsesOnly: false },
    { id: 'preflight-2', responsesOnly: false },
    { id: 'preflight-3', responsesOnly: true  },
  ];

  const cliFilter  = process.argv.slice(2);
  const assignments = cliFilter.length
    ? ALL_ASSIGNMENTS.filter(a => cliFilter.includes(a.id))
    : ALL_ASSIGNMENTS;

  if (!assignments.length) {
    console.error(`No matching assignments for: ${cliFilter.join(', ')}`);
    console.error(`Available: ${ALL_ASSIGNMENTS.map(a => a.id).join(', ')}`);
    process.exit(1);
  }

  for (const { id: assignmentId, responsesOnly } of assignments) {
    console.log(`\nGenerating responses for ${assignmentId}${responsesOnly ? ' (responses only)' : ''}…`);
    const responses = [];
    const scores    = [];

    for (const [sectionId, sectStudents] of Object.entries(bySect)) {
      // Skip ~10% of students deterministically
      const skipCount = Math.round(sectStudents.length * MISS_RATE);
      const sorted    = [...sectStudents].sort((a, b) => a.student_id - b.student_id);
      const skipSet   = new Set(
        sorted.filter(s => s.student_id % 10 === 0).slice(0, skipCount).map(s => s.student_id)
      );

      for (const student of sectStudents) {
        if (skipSet.has(student.student_id)) continue;
        const answers = generateAnswers(assignmentId, student);
        const dt      = randomSubmitDate();
        responses.push({
          student_id:    student.student_id,
          assignment_id: assignmentId,
          answers,
          submitted_at:  dt,
          updated_at:    dt,
        });
        if (!responsesOnly) {
          scores.push(generateScore(assignmentId, answers, student.student_id));
        }
      }
    }

    const submitting = responses.length;
    const missing    = students.length - submitting;
    console.log(`  ${submitting} submissions, ${missing} missing`);

    const CHUNK = 500;
    console.log('  Upserting responses…');
    for (let i = 0; i < responses.length; i += CHUNK) {
      await dbUpsert('responses', responses.slice(i, i + CHUNK), 'student_id,assignment_id');
      process.stdout.write(`    ${Math.min(i + CHUNK, responses.length)}/${responses.length}\r`);
    }
    console.log(`  ✓ ${responses.length} responses upserted`);

    if (!responsesOnly) {
      console.log('  Upserting scores (unfinalized)…');
      for (let i = 0; i < scores.length; i += CHUNK) {
        await dbUpsert('scores', scores.slice(i, i + CHUNK), 'student_id,assignment_id');
        process.stdout.write(`    ${Math.min(i + CHUNK, scores.length)}/${scores.length}\r`);
      }
      console.log(`  ✓ ${scores.length} scores upserted`);
    }
  }

  console.log('\n✓ Done! Open admin.html → Grade tab to review suggested scores.');
  console.log('  Verify student login: ID 3000100001, password 100001');
  console.log('  Run /preflight-analyze phys-215 preflight-3 to grade the new responses.');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
