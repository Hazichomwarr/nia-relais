import { NextResponse } from "next/server";

import { auth } from "@/auth";

export default auth((request) => {
  if (!request.auth?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/goals/:path*",
    "/custodian/:path*",
    "/deposits/:path*",
  ],
};
