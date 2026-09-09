All core is a state machine based on the product state every cycle.
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

