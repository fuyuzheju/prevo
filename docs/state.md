All core is a state machine based on the product state everyday.
State {
    inventory: number, // inventory until end of the day
    soldTransit: number, // sold but not sent until end of the day
    boughtTransit: number, // bought but not received until end of the day
    sent: number, // all sent during the whole day
    received: number, // all received during the whole day
    sale: number, // sale accounts during the whole day
    purchase: number, // purchase accounts during the whole day
}

Apparently, 
inventory = inventory[-1] + received - sent
sold = sold[-1] + sale - sent
bought = bought[-1] + purchase - received

avaiable = inventory + bought - sold

Purchase strategy is based on the relationship between the avaiable and the predicted sale

