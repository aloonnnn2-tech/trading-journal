import { permanentRedirect } from "next/navigation";

// /home-v2 was the comparison address while this design was being decided on.
// It has now been promoted to / (see src/app/page.tsx), so this route only
// exists to forward anyone still holding the old link.
//
// A permanent (308) redirect rather than leaving a second copy of the page
// here: two URLs serving identical content split their own search ranking and
// give analytics two entries for one page. 308 also tells a crawler the move
// is settled, so / is what gets indexed.
export default function HomeV2Page() {
  permanentRedirect("/");
}
