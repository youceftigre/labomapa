import { createFileRoute } from "@tanstack/react-router";
import { WarehouseApp } from "@/components/warehouse/app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <WarehouseApp />;
}
