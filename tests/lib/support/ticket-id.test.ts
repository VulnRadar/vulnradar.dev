import { describe, it, expect } from "vitest";
import { parseTicketId } from "@/lib/support/ticket-id";

describe("parseTicketId", () => {
  it.each([
    ["1", 1],
    ["12", 12],
    ["9876543210".slice(0, 9), 987654321],
    ["2147483647", 2147483647],
  ])("reads %j as %i", (raw, expected) => {
    expect(parseTicketId(raw)).toBe(expected);
  });

  it.each([
    "12.png",
    "12.svg",
    "12.webp",
    "12abc",
    "1e3",
    "0x10",
    "1.5",
    "012",
    "0",
    "-5",
    "+5",
    "",
    " 12",
    "12 ",
    "12\n",
    "１２",
    "99999999999",
    "2147483648",
  ])("refuses %j", (raw) => {
    expect(parseTicketId(raw)).toBeNull();
  });
});
