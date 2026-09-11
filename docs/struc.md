This file describes the structure of the project.

# server

1. State machine of every cycle trading(state.md).
    - dependencies: none
    - API: input sent, received, sale, purchase, calculate next state; read every state

1. Sale predictor(predictor.md).
    - dependencies: none
    - API: input history sale, output predicted sale.

1. Purchase decision making(decision.md).
    - dependencies: sale predictor, state machine
    - API: for every product type, execute purchase strategy and calculate purchase suggestion.

1. State summary
    - dependencies: state machine
    - API: 
        - purchase(amount: number) => boolean, add a purchase bill to the current state, and be settled later
        - sell(amount: number) => undefined, add a sell bill
        - send(amount: number) => undefined, add a send record
        - receive(amount: number) => undefined, add a receive record
        - settlePendingByDay() => number, fold the pending records per local calendar day into cycles (each day becomes one cycle, feeding the four state machine inputs); driven by the daily settlement job only, there is no HTTP endpoint

1. User system
    - dependencies: none
    - API: add user; remove user; login and give JWT token; change password; auth and identify;

1. WebAPI
    - dependencies: state summary, user system
    - decode user identity, access user data or call state summary functions

# client
login/register page, user info page, add new record page, inventory info page
