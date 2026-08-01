import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Cloudy,
  Moon,
  Sun,
} from "lucide-react";
import { weatherTone } from "@/lib/weather/codes";
import type { WeatherCode } from "@/lib/weather/types";
import { cn } from "@/lib/utils";

export function WeatherIcon({
  code,
  isDay = true,
  className,
  size = 28,
}: {
  code: WeatherCode;
  isDay?: boolean;
  className?: string;
  size?: number;
}) {
  const tone = weatherTone(code);
  const props = { size, strokeWidth: 1.6, className: cn("shrink-0", className) };
  switch (tone) {
    case "clear":
      return isDay ? (
        <Sun {...props} className={cn(props.className, "text-warn")} />
      ) : (
        <Moon {...props} className={cn(props.className, "text-primary")} />
      );
    case "cloud":
      return code === 3 ? (
        <Cloud {...props} className={cn(props.className, "text-muted")} />
      ) : (
        <Cloudy {...props} className={cn(props.className, "text-muted")} />
      );
    case "rain":
      return <CloudRain {...props} className={cn(props.className, "text-primary")} />;
    case "snow":
      return <CloudSnow {...props} className={cn(props.className, "text-accent")} />;
    case "storm":
      return <CloudLightning {...props} className={cn(props.className, "text-warn")} />;
    case "fog":
      return <CloudFog {...props} className={cn(props.className, "text-subtle")} />;
    default:
      return <Cloud {...props} />;
  }
}
