import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";

const router = getRouter();

export default function PagesApp() {
  return <RouterProvider router={router} />;
}
