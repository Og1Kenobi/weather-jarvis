import { createFileRoute } from "@tanstack/react-router";
import { WeatherJarvisApp } from "@/components/weather/WeatherJarvisApp";

export const Route = createFileRoute("/")({
  component: HomePage,
  ssr: false,
});

function HomePage() {
  return <WeatherJarvisApp />;
}
