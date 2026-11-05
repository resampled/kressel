// krplayer's internal bytecode. Flat Int32Array: [op, operands...]. Never saved; rebuilt at load.

export const Op = {
  CONST: 1,      // k              -> consts[k]
  GET: 2,        // scope id       (FIELD scopes pop the instance first)
  SET: 3,        // scope id own   stack: value [inst]
  GETI: 4,       // scope id       stack: [inst] index -> value
  SETI: 5,       // scope id own   stack: value [inst] index
  BIN: 6,        // k              a b -> a op b
  UN: 7,         // k              a -> op a
  JMP: 8,        // addr
  JF: 9,         // addr           pops; jumps if falsy
  JT: 10,        // addr           pops; jumps if truthy
  CALL: 11,      // builtin argc   args pushed last-to-first (GM evaluates right to left)
  POP: 12,
  DUP: 13,       // n              duplicates the top n items
  SINK: 14,      // n              moves the top item down under the n items below it
  WITH_BEGIN: 15,// end            pops target; no instances -> jump to end
  WITH_NEXT: 16, // body           next instance -> jump to body, else pop the with frame
  WITH_EXIT: 17, //                pops the with frame (break out of with)
  RET: 18,       //                pops the return value
  EXIT: 19,
  BOOL: 20,      //                a -> truthy(a) as a bool
  SELFID: 21,
  OTHERID: 22,
  CALLF: 23,     // fn argc        user function call (self/other unchanged)
  CALLV: 24,     // argc           stack: args self func -> result (methods, script ids)
  NEW: 25,       // fn argc        constructor call -> struct
  NEWV: 26,      // argc           stack: args ctor -> struct
  AROWV: 27,     // scope id own   stack: [inst] index -> row  (var[index] as an array to write into)
  AROW: 28,      // own            stack: row index -> row[index] as an array to write into
  AGET: 29,      //                stack: arr index -> arr[index]
  ASET: 30,      // own            stack: value row index -> (row[index] = value)
  ARRAY: 31,     // n              n items (first element deepest) -> array
} as const;

/** Variable scopes for GET/SET/GETI/SETI. */
export const S = {
  LOCAL: 0,
  SELF: 1,    // user variable on self
  FIELD: 2,   // user variable on an instance/object/struct popped from the stack
  GLOBAL: 3,  // user global
  BSELF: 4,   // built-in instance variable on self
  BFIELD: 5,  // built-in instance variable on a popped instance/object
  BGLOBAL: 6, // built-in global (room, room_width...)
  ARG: 7,     // argumentN (id = N); argument[i] with GETI/SETI (id = -1)
} as const;

export const BinOp = {
  add: 0, sub: 1, mul: 2, div: 3, idiv: 4, mod: 5, eq: 6, neq: 7, lt: 8, lte: 9, gt: 10, gte: 11,
  xor: 12, band: 13, bor: 14, bxor: 15, shl: 16, shr: 17,
} as const;
export const UnOp = { neg: 0, not: 1, bnot: 2 } as const;

/** A compiled hat/function body. */
export interface Block {
  code: Int32Array;
  consts: unknown[];
  nLocals: number;
  /** Where it came from, e.g. "obj_player/evt_step". */
  name: string;
  /** Statement start pcs and their paths inside the script, for error messages. */
  stmtPc: number[];
  stmtPath: string[];
  /** Object events: the object that defined it and the event key (see evKey), for event_inherited. */
  owner?: number; ev?: number;
}

/** Event keys: simple events by EV slot; alarms, user, async, collision and key events offset. */
export const EK = { alarm: 100, user: 200, async: 300, collision: 1000, key: 100000 } as const;
