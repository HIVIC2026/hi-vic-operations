// Trade button and input classes, kept apart from TradeShell so the sign-in page can use them without loading the
// installer screen frame. TradeShell re-exports them.
export const greenBtn = "flex h-12 w-full items-center justify-center gap-[7px] rounded-[10px] bg-action px-[15px] text-[13px] font-bold text-action-foreground disabled:cursor-not-allowed disabled:opacity-45 md:h-[42px] md:w-auto";
export const ghostBtn = "flex h-12 w-full items-center justify-center gap-[7px] rounded-[10px] border border-line bg-paper px-[15px] text-[13px] font-bold text-hiv-blue md:h-[42px] md:w-auto";
export const inputCls = "h-12 w-full min-w-0 max-w-full rounded-[9px] border border-field-line bg-paper px-3 text-base text-ink md:h-[42px] md:text-sm";
