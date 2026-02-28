import { redirect } from "next/navigation";

export default function TryDemoPage() {
  redirect("/forecast?mode=demo");
}

