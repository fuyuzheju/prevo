All core is a state machine based on the product state every cycle.

All amounts are signed fixed-point quantities: integers in units of 1/1000
(QUANTITY_SCALE in shared/quantity.ts), so they can be fractional (500 = 0.5)
and negative (a return / correction reversing its line); 0 is a legal no-op.
Each line of the state machine is linear, so negative inputs need no special
handling.

State {
    inventory: number, // inventory until end of the cycle
    soldTransit: number, // sold but not sent until end of the cycle
    boughtTransit: number, // bought but not received until end of the cycle
    sent: number, // all sent during the whole cycle
    received: number, // all received during the whole cycle
    sale: number, // sale accounts during the whole cycle
    purchase: number, // purchase accounts during the whole cycle
}

Apparently, 
inventory = inventory[-1] + received - sent
sold = sold[-1] + sale - sent
bought = bought[-1] + purchase - received

avaiable = inventory + bought - sold

Purchase strategy is based on the relationship between the avaiable and the predicted sale

