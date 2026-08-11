import type { Metadata } from "next";
import VerifyClient from "@/components/verify/verify-client";

export const metadata: Metadata = {
  title: "Verify",
  description:
    "What dorr proves, what it does not, and the exact checks Flare performs — read live from the running system.",
};

export default function VerifyPage() {
  return <VerifyClient />;
}
