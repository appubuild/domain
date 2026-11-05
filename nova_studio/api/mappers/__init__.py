"""L4 — mappers: the only place an entity becomes a DTO.

A router that built its response body inline would be a second definition of the
wire contract, living in the one place nobody looks when the contract changes.
The mapping is therefore a module per resource, with one function per direction
and no logic in it beyond the translation.

Two rules:

* **A mapper never decides.** It does not validate, default or repair. A value
  the domain considers impossible cannot reach here, and if it somehow does, the
  DTO's own validation is what should complain — loudly, and once.
* **A mapper never talks to the outside world.** No clock, no bus, no store.
  It is given values and returns values, which is what makes it the easiest
  thing in the layer to test.
"""
