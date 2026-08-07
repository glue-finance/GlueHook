import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { DocsSidebar } from "@/components/docs/Sidebar";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav
        right={
          <Link href="/app" className="btn btn-primary btn-sm">
            Launch App
          </Link>
        }
      />
      <div className="mx-auto max-w-7xl px-5 pb-16 pt-32">
        <div className="lg:grid lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-12">
          <DocsSidebar />
          <div>{children}</div>
        </div>
      </div>
      <Footer />
    </>
  );
}
