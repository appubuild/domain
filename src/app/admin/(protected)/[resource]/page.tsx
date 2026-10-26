import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ADMIN_RESOURCES, getResource } from "@/lib/admin/resources";
import { ResourceManager } from "@/components/admin/resource-manager";

export const dynamicParams = false;

export function generateStaticParams() {
  return ADMIN_RESOURCES.map((resource) => ({ resource: resource.key }));
}

export async function generateMetadata({ params }: { params: Promise<{ resource: string }> }): Promise<Metadata> {
  const { resource } = await params;
  const definition = getResource(resource);
  return {
    title: definition ? `${definition.label} · Admin` : "Admin",
    robots: { index: false, follow: false },
  };
}

export default async function AdminResourcePage({ params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  const definition = getResource(resource);
  if (!definition) notFound();
  return <ResourceManager resource={definition} />;
}
