package org.ecotwin.integration.jakarta;

import jakarta.ejb.ApplicationException;

@ApplicationException(rollback = true)
public class CalculationInputException extends RuntimeException {
    public final int status;
    public CalculationInputException(int status, String message) {
        super(message);
        this.status = status;
    }
}
