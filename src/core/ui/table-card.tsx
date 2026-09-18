import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/ui/card";

/**
 * The surface a data table sits on.
 *
 * Every list in the app is inside one of these, at the owner's direction. The app had
 * previously split them — a table that WAS the page sat on the page ground, a table
 * that was one section among several took a card — which is defensible but reads as
 * two designs when you put two pages side by side, and that is the comparison a user
 * actually makes.
 *
 * `title` is for a table that needs naming because something else shares the page
 * ("24 payments" under a row of KPI cards). A list page whose header already carries
 * the count passes nothing rather than printing it twice.
 */
export function TableCard({
  title,
  children,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      {title ? (
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
      ) : null}
      <CardContent>{children}</CardContent>
    </Card>
  );
}
