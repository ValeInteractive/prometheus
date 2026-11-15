"use client";

import Image from "next/image";
import { useState } from "react";

export default function PrometheusPoster({ id, title, hasPoster }: {
  id: string;
  title: string;
  hasPoster: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="prometheus-poster">
      {!loaded && <span aria-hidden="true">{title}</span>}
      {hasPoster && !failed && (
        <Image
          src={`/api/artwork?id=${encodeURIComponent(id)}&type=Primary`}
          alt=""
          width={400}
          height={600}
          unoptimized
          loading="lazy"
          className={loaded ? "h-full w-full object-contain" : "invisible h-full w-full object-contain"}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
